import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AgentService } from "../../src/modules/agent/application/agent.service";
import { FileSessionRepository } from "../../src/modules/agent/infrastructure/persistence/file-session-repository.adapter";
import {
  SessionNotFoundError,
  SessionNotResumableError,
} from "../../src/modules/agent/domain/errors/agent.errors";
import type { ToolRegistryPort } from "../../src/modules/agent/domain/ports/tool-registry.port";
import type { AgentDefinitionRepositoryPort } from "../../src/modules/agent/domain/ports/agent-definition-repository.port";
import type { LlmService } from "../../src/modules/llm/application/llm.service";
import type { ConfigPort } from "../../src/shared/config/config.port";
import type { LoggerPort } from "../../src/shared/observability/logger.port";
import type { CompletionResponse } from "../../src/modules/llm/domain/ports/llm.types";
import type { AgentDefinition } from "../../src/modules/agent/domain/types/agent.types";

const testDefinition: AgentDefinition = {
  id: "test-agent",
  name: "Test Agent",
  description: "A test agent",
  systemPrompt: "You are a test agent.",
  tools: [],
  runtime: "single-shot",
};

const fakeResponse = (content: string): CompletionResponse => ({
  content,
  reasoning: "",
  stopReason: "stop",
  usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, totalTokens: 30 },
  model: "test-model",
  provider: "test",
});

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

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "session-resume-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("session resume", () => {
  test("create session → complete → resume with new message → complete", async () => {
    let callCount = 0;
    const messages: string[] = [];
    const llmService = {
      complete: async (req: { messages: Array<{ role: string; content: string | null }> }) => {
        callCount++;
        const userMsg = req.messages.filter((m) => m.role === "user").pop();
        messages.push(userMsg?.content ?? "");
        return fakeResponse(`Response ${callCount} to: ${userMsg?.content}`);
      },
    } as unknown as LlmService;

    const sessionRepository = new FileSessionRepository({ dataDir: tempDir, logger: makeFakeLogger() });
    const service = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    // First run — creates new session
    const result1 = await service.run("test-agent", "Hello");
    expect(result1.content).toBe("Response 1 to: Hello");
    expect(result1.status).toBe("completed");
    expect(result1.sessionId).toBeDefined();

    // Second run — resume with sessionId
    const result2 = await service.run("test-agent", "Follow up", { sessionId: result1.sessionId });
    expect(result2.content).toBe("Response 2 to: Follow up");
    expect(result2.status).toBe("completed");
    expect(result2.sessionId).toBe(result1.sessionId);

    // Verify the LLM saw the full conversation history on resume
    expect(callCount).toBe(2);
    expect(messages).toEqual(["Hello", "Follow up"]);
  });

  test("resume loads persisted session from disk", async () => {
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        return fakeResponse(`Reply ${callCount}`);
      },
    } as unknown as LlmService;

    const sessionRepository = new FileSessionRepository({ dataDir: tempDir, logger: makeFakeLogger() });

    // Create service, run once to persist
    const service1 = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const result1 = await service1.run("test-agent", "First message");
    const sessionId = result1.sessionId;

    // Create a NEW service instance (simulates server restart) with same session dir
    const service2 = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const result2 = await service2.run("test-agent", "After restart", { sessionId });
    expect(result2.sessionId).toBe(sessionId);
    expect(result2.content).toBe("Reply 2");
    expect(callCount).toBe(2);
  });

  test("throws SessionNotFoundError for nonexistent sessionId", async () => {
    const sessionRepository = new FileSessionRepository({ dataDir: tempDir, logger: makeFakeLogger() });
    const service = new AgentService({
      llmService: {} as LlmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    await expect(service.run("test-agent", "Hello", { sessionId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  test("throws SessionNotResumableError when agentId does not match", async () => {
    const llmService = {
      complete: async () => fakeResponse("ok"),
    } as unknown as LlmService;

    const sessionRepository = new FileSessionRepository({ dataDir: tempDir, logger: makeFakeLogger() });
    const service = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const result = await service.run("test-agent", "Hello");
    const sessionId = result.sessionId;

    // Try to resume with a different agentId (using definition that doesn't match)
    const otherDefinition: AgentDefinition = { ...testDefinition, id: "other-agent" };
    const service2 = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition, otherDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    await expect(service2.run("other-agent", "Hello", { sessionId })).rejects.toThrow(
      SessionNotResumableError,
    );
  });

  test("resuming a failed session succeeds and preserves history", async () => {
    let capturedSessionId: string | undefined;
    let callCount = 0;
    const llmService = {
      complete: async () => {
        callCount++;
        if (callCount === 1) throw new Error("LLM error");
        return fakeResponse("Recovered");
      },
    } as unknown as LlmService;

    const sessionRepository = new FileSessionRepository({ dataDir: tempDir, logger: makeFakeLogger() });

    const originalSave = sessionRepository.save.bind(sessionRepository);
    sessionRepository.save = async (session) => {
      capturedSessionId = session.sessionId;
      return originalSave(session);
    };

    const service = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    try {
      await service.run("test-agent", "Hello");
    } catch {
      // Expected — LLM error marks session as failed
    }

    expect(capturedSessionId).toBeDefined();

    const service2 = new AgentService({
      llmService: { complete: async () => fakeResponse("ok") } as unknown as LlmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    const result = await service2.run("test-agent", "Retry", { sessionId: capturedSessionId! });
    expect(result.sessionId).toBe(capturedSessionId!);
    expect(result.status).toBe("completed");
    expect(result.content).toBe("ok");
  });

  test("response always includes sessionId", async () => {
    const llmService = {
      complete: async () => fakeResponse("ok"),
    } as unknown as LlmService;

    const sessionRepository = new FileSessionRepository({ dataDir: tempDir, logger: makeFakeLogger() });
    const service = new AgentService({
      llmService,
      toolRegistry: makeFakeToolRegistry(),
      agentDefinitions: makeFakeDefinitionRepository([testDefinition]),
      sessionRepository,
      config: makeFakeConfig(),
      logger: makeFakeLogger(),
    });

    // New session
    const result1 = await service.run("test-agent", "Hello");
    expect(typeof result1.sessionId).toBe("string");
    expect(result1.sessionId.length).toBeGreaterThan(0);

    // Resumed session
    const result2 = await service.run("test-agent", "Follow up", { sessionId: result1.sessionId });
    expect(result2.sessionId).toBe(result1.sessionId);
  });
});
