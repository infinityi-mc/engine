import { describe, expect, test } from "bun:test";
import { ToolUseLoop } from "../../src/modules/agent/application/runtime/tool-use-loop";
import { MaxIterationsReachedError, SessionTimeoutError } from "../../src/modules/agent/domain/errors/agent.errors";
import type { LlmService } from "../../src/modules/llm/application/llm.service";
import type { ToolRegistryPort } from "../../src/modules/agent/domain/ports/tool-registry.port";
import type { SessionRepositoryPort } from "../../src/modules/agent/domain/ports/session-repository.port";
import type { LoggerPort } from "../../src/shared/observability/logger.port";
import type { CompletionResponse, TokenUsage, ToolCall } from "../../src/modules/llm/domain/ports/llm.types";
import type { AgentDefinition, AgentSession } from "../../src/modules/agent/domain/types/agent.types";
import type { Tool, ToolResult } from "../../src/modules/agent/domain/types/tool.types";
import {
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderRateLimitError,
} from "../../src/modules/llm/domain/errors/llm.errors";

const fakeUsage = (overrides?: Partial<TokenUsage>): TokenUsage => ({
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 0,
  totalTokens: 30,
  ...overrides,
});

const fakeResponse = (overrides?: Partial<CompletionResponse>): CompletionResponse => ({
  content: "Hello!",
  reasoning: "",
  stopReason: "stop",
  usage: fakeUsage(),
  model: "test-model",
  provider: "test",
  ...overrides,
});

const fakeToolCall = (name: string, args: string = "{}", id: string = `call_${name}`): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: args },
});

const testDefinition: AgentDefinition = {
  id: "test-agent",
  name: "Test Agent",
  description: "A test agent",
  systemPrompt: "You are a test agent.",
  tools: ["read_file", "write_file"],
  runtime: "tool-use-loop",
};

function makeFakeLogger(): LoggerPort {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function makeFakeSessionRepository(): SessionRepositoryPort {
  return {
    save: async () => {},
    load: async () => null,
  };
}

function makeFakeToolRegistry(tools: Tool[] = []): ToolRegistryPort {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    get: (name: string) => map.get(name),
    getAll: () => [...map.values()],
    getDefinitions: (names: readonly string[]) =>
      names.flatMap((name) => {
        const tool = map.get(name);
        return tool ? [{ name: tool.name, description: tool.description, parameters: tool.inputSchema }] : [];
      }),
    register: () => {},
  };
}

function createSession(definition: AgentDefinition, userMessage: string): AgentSession {
  return {
    sessionId: crypto.randomUUID(),
    agentId: definition.id,
    messages: [
      { role: "system", content: definition.systemPrompt },
      { role: "user", content: userMessage },
    ],
    status: "active",
    createdAt: Date.now(),
    completedAt: null,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    iterationCount: 0,
  };
}

describe("ToolUseLoop", () => {
  test("completes immediately when LLM returns stop (no tool calls)", async () => {
    const llmService = {
      complete: async () => fakeResponse({ content: "Direct answer", stopReason: "stop" }),
    } as unknown as LlmService;

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Hello");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("Direct answer");
    expect(result.status).toBe("completed");
    expect(result.totalIterations).toBe(1);
    expect(result.stopReason).toBe("stop");
  });

  test("executes tool calls and feeds results back to LLM", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            toolCalls: [fakeToolCall("read_file", '{"path": "/test.txt"}')],
          });
        }
        return fakeResponse({ content: "I read the file", stopReason: "stop" });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      execute: async (input: unknown) => ({ output: "File contents here" }),
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Read /test.txt");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("I read the file");
    expect(result.status).toBe("completed");
    expect(result.totalIterations).toBe(2);
    expect(callCount).toBe(2);

    // Verify session messages include tool result
    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toBe("File contents here");
    expect(toolMessages[0]!.toolCallId).toBe("call_read_file");
  });

  test("executes multiple tool calls in parallel", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            toolCalls: [
              fakeToolCall("read_file", '{"path": "/a.txt"}', "call_1"),
              fakeToolCall("read_file", '{"path": "/b.txt"}', "call_2"),
            ],
          });
        }
        return fakeResponse({ content: "Both files read", stopReason: "stop" });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      execute: async (input: unknown) => {
        const args = input as { path: string };
        return { output: `Contents of ${args.path}` };
      },
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Read both files");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("Both files read");
    expect(result.status).toBe("completed");

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map((m) => m.toolCallId).sort()).toEqual(["call_1", "call_2"]);
  });

  test("reports tool execution error back to LLM", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            toolCalls: [fakeToolCall("read_file", '{"path": "/test.txt"}')],
          });
        }
        return fakeResponse({ content: "The file read failed, let me try another approach", stopReason: "stop" });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: {},
      execute: async () => ({ output: "Permission denied", isError: true }),
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Read /test.txt");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("The file read failed, let me try another approach");
    expect(result.status).toBe("completed");

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toBe("Permission denied");
  });

  test("reports tool not found error back to LLM", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            toolCalls: [fakeToolCall("nonexistent_tool", '{}')],
          });
        }
        return fakeResponse({ content: "That tool doesn't exist, I'll try something else", stopReason: "stop" });
      },
    } as unknown as LlmService;

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Do something");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("That tool doesn't exist, I'll try something else");

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toContain("Tool not found");
  });

  test("reports invalid JSON arguments error back to LLM", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            toolCalls: [fakeToolCall("read_file", "not valid json")],
          });
        }
        return fakeResponse({ content: "I had invalid arguments, let me fix that", stopReason: "stop" });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: {},
      execute: async () => ({ output: "should not reach here" }),
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Read a file");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("I had invalid arguments, let me fix that");

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.content).toContain("Invalid JSON");
  });

  test("throws MaxIterationsReachedError when limit is exceeded", async () => {
    const llmService = {
      complete: async () =>
        fakeResponse({
          stopReason: "tool_calls",
          toolCalls: [fakeToolCall("read_file")],
        }),
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: {},
      execute: async () => ({ output: "result" }),
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Keep reading");

    await expect(loop.run(session, testDefinition, 3, 300_000)).rejects.toThrow(MaxIterationsReachedError);
    await expect(loop.run(session, testDefinition, 3, 300_000)).rejects.toThrow(
      "Agent reached maximum iterations (3)",
    );
  });

  test("throws SessionTimeoutError when timeout is exceeded", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        // Simulate slow LLM by advancing time — but we can't control Date.now()
        // Instead, use a very short timeout (1ms) which will always be exceeded
        return fakeResponse({
          stopReason: "tool_calls",
          toolCalls: [fakeToolCall("read_file")],
        });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: {},
      execute: async () => {
        // Small delay to ensure timeout is exceeded
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { output: "result" };
      },
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Keep reading");

    // 1ms timeout — will always be exceeded
    await expect(loop.run(session, testDefinition, 100, 1)).rejects.toThrow(SessionTimeoutError);
  });

  test("throws ProviderAuthError immediately (fatal LLM error)", async () => {
    const llmService = {
      complete: async () => {
        throw new ProviderAuthError("test");
      },
    } as unknown as LlmService;

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Hello");

    await expect(loop.run(session, testDefinition, 10, 300_000)).rejects.toThrow(ProviderAuthError);
    expect(session.status).toBe("failed");
  });

  test("throws ProviderNotFoundError immediately (fatal LLM error)", async () => {
    const llmService = {
      complete: async () => {
        throw new ProviderNotFoundError("unknown");
      },
    } as unknown as LlmService;

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Hello");

    await expect(loop.run(session, testDefinition, 10, 300_000)).rejects.toThrow(ProviderNotFoundError);
    expect(session.status).toBe("failed");
  });

  test("throws ProviderRateLimitError immediately (fatal LLM error)", async () => {
    const llmService = {
      complete: async () => {
        throw new ProviderRateLimitError("test", 5000);
      },
    } as unknown as LlmService;

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Hello");

    await expect(loop.run(session, testDefinition, 10, 300_000)).rejects.toThrow(ProviderRateLimitError);
    expect(session.status).toBe("failed");
  });

  test("continues when one tool in a parallel batch fails", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            toolCalls: [
              fakeToolCall("read_file", '{"path": "/a.txt"}', "call_1"),
              fakeToolCall("write_file", '{"path": "/b.txt"}', "call_2"),
            ],
          });
        }
        return fakeResponse({ content: "Done despite one failure", stopReason: "stop" });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: {},
      execute: async () => ({ output: "File contents" }),
    };

    const writeTool: Tool = {
      name: "write_file",
      description: "Write a file",
      inputSchema: {},
      execute: async () => { throw new Error("Disk full"); },
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool, writeTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Read and write");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("Done despite one failure");

    const toolMessages = session.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(2);
    // read_file succeeded
    expect(toolMessages.find((m) => m.toolCallId === "call_1")!.content).toBe("File contents");
    // write_file failed — error reported as tool result
    expect(toolMessages.find((m) => m.toolCallId === "call_2")!.content).toContain("Disk full");
  });

  test("accumulates token usage across iterations", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) {
          return fakeResponse({
            stopReason: "tool_calls",
            usage: fakeUsage({ inputTokens: 50, outputTokens: 10, totalTokens: 60 }),
            toolCalls: [fakeToolCall("read_file")],
          });
        }
        return fakeResponse({
          content: "Final answer",
          stopReason: "stop",
          usage: fakeUsage({ inputTokens: 80, outputTokens: 30, totalTokens: 110 }),
        });
      },
    } as unknown as LlmService;

    const readTool: Tool = {
      name: "read_file",
      description: "Read a file",
      inputSchema: {},
      execute: async () => ({ output: "result" }),
    };

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry([readTool]),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Read and answer");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.usage.inputTokens).toBe(130); // 50 + 80
    expect(result.usage.outputTokens).toBe(40); // 10 + 30
    expect(result.usage.totalTokens).toBe(170); // 60 + 110
  });

  test("handles stopReason 'length' as final answer", async () => {
    const llmService = {
      complete: async () =>
        fakeResponse({ content: "Truncated answer...", stopReason: "length" }),
    } as unknown as LlmService;

    const loop = new ToolUseLoop({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      logger: makeFakeLogger(),
      sessionRepository: makeFakeSessionRepository(),
    });

    const session = createSession(testDefinition, "Write a lot");
    const result = await loop.run(session, testDefinition, 10, 300_000);

    expect(result.content).toBe("Truncated answer...");
    expect(result.status).toBe("completed");
    expect(result.stopReason).toBe("length");
  });
});
