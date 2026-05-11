import { describe, expect, test } from "bun:test";
import { AgentService } from "../../src/modules/agent/application/agent.service";
import { AgentNotFoundError } from "../../src/modules/agent/domain/errors/agent.errors";
import type { ToolRegistryPort } from "../../src/modules/agent/domain/ports/tool-registry.port";
import type { AgentDefinitionRepositoryPort } from "../../src/modules/agent/domain/ports/agent-definition-repository.port";
import type { LlmService } from "../../src/modules/llm/application/llm.service";
import type { ConfigPort } from "../../src/shared/config/config.port";
import type { LoggerPort } from "../../src/shared/observability/logger.port";
import type { SessionRepositoryPort } from "../../src/modules/agent/domain/ports/session-repository.port";
import type { CompletionResponse, TokenUsage } from "../../src/modules/llm/domain/ports/llm.types";
import type { AgentDefinition } from "../../src/modules/agent/domain/types/agent.types";

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

const testDefinition: AgentDefinition = {
  id: "test-agent",
  name: "Test Agent",
  description: "A test agent",
  systemPrompt: "You are a test agent.",
  tools: [],
  runtime: "tool-use-loop",
};

const singleShotDefinition: AgentDefinition = {
  id: "single-shot-agent",
  name: "Single Shot Agent",
  description: "A single-shot agent",
  systemPrompt: "You are a single-shot agent.",
  tools: [],
  runtime: "single-shot",
};

function makeFakeConfig(): ConfigPort {
  return {
    getConfig: () => ({
      llm: { defaultProvider: "test", defaultModel: "test-model", providers: {} },
    }),
    getLlmConfig: () => ({ defaultProvider: "test", defaultModel: "test-model", providers: {} }),
    getAgentConfig: () => ({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {},
    }),
    getMinecraftAgentConfig: () => ({ messageCap: 50, sessionTtlMs: 172_800_000, playerCooldownMs: 5_000 }),
    getApiKey: () => "",
    getBaseUrl: () => "",
    onChange: () => () => {},
    stop: () => {},
  };
}

function makeFakeLogger(): LoggerPort {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function makeFakeToolRegistry(): ToolRegistryPort {
  return {
    get: () => undefined,
    getAll: () => [],
    getByGroup: () => [],
    getDefinitions: () => [],
    register: () => {},
  };
}

function makeFakeDefinitionRepository(definitions: AgentDefinition[]): AgentDefinitionRepositoryPort {
  const map = new Map(definitions.map((d) => [d.id, d]));
  return {
    get: async (id: string) => map.get(id),
    getAll: async () => [...map.values()],
  };
}

function makeFakeSessionRepository(): SessionRepositoryPort {
  return {
    save: async () => {},
    load: async () => null,
  };
}

describe("AgentService", () => {
  test("throws AgentNotFoundError for unknown agent id", async () => {
    const service = new AgentService({
      llmService: {} as LlmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([]),
      sessionRepository: makeFakeSessionRepository(),
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    await expect(service.run("unknown", "Hello")).rejects.toThrow(AgentNotFoundError);
  });

  test("runs single-shot agent successfully", async () => {
    const llmService = {
      complete: async () => fakeResponse({ content: "Hi there!" }),
    } as unknown as LlmService;

    const service = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([singleShotDefinition]),
      sessionRepository: makeFakeSessionRepository(),
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const result = await service.run("single-shot-agent", "Hello");

    expect(result.content).toBe("Hi there!");
    expect(result.status).toBe("completed");
    expect(result.totalIterations).toBe(1);
    expect(result.stopReason).toBe("stop");
  });

  test("runs tool-use-loop agent with no tool calls (immediate stop)", async () => {
    const llmService = {
      complete: async () => fakeResponse({ content: "Direct answer", stopReason: "stop" }),
    } as unknown as LlmService;

    const service = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository: makeFakeSessionRepository(),
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const result = await service.run("test-agent", "Hello");

    expect(result.content).toBe("Direct answer");
    expect(result.status).toBe("completed");
    expect(result.totalIterations).toBe(1);
  });

  test("getDefinition returns agent definition by id", async () => {
    const service = new AgentService({
      llmService: {} as LlmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository: makeFakeSessionRepository(),
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    expect(await service.getDefinition("test-agent")).toEqual(testDefinition);
    expect(await service.getDefinition("unknown")).toBeUndefined();
  });

  test("listDefinitions returns all definitions", async () => {
    const service = new AgentService({
      llmService: {} as LlmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition, singleShotDefinition]),
      sessionRepository: makeFakeSessionRepository(),
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const list = await service.listDefinitions();
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id).sort()).toEqual(["single-shot-agent", "test-agent"]);
  });

  test("resolves maxIterations from request override", async () => {
    let capturedMaxIterations: number | undefined;
    const llmService = {
      complete: async (req: { maxTokens?: number; temperature?: number; maxIterations?: number }) => {
        // We can't directly observe maxIterations from LlmService.complete
        // because it's not a CompletionRequest field — it's a loop-level concern.
        // Instead, we verify the MaxIterationsReachedError is thrown at the right count.
        return fakeResponse({ stopReason: "tool_calls", toolCalls: [{ id: "1", type: "function", function: { name: "test_tool", arguments: "{}" } }] });
      },
    } as unknown as LlmService;

    const toolRegistry = {
      ...makeFakeToolRegistry(),
      get: () => ({
        name: "test_tool",
        description: "A test tool",
        inputSchema: {},
        execute: async () => ({ output: "tool result" }),
      }),
      getDefinitions: () => [{ name: "test_tool", description: "A test tool", parameters: {} }],
    };

    const service = new AgentService({
      llmService,
      toolRegistry,
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository: makeFakeSessionRepository(),
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    // With maxIterations=1, the loop should hit the limit after 1 iteration
    await expect(service.run("test-agent", "Hello", { maxIterations: 1 })).rejects.toThrow(
      "Agent reached maximum iterations (1)",
    );
  });
});
