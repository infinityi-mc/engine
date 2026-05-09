import { describe, expect, test } from "bun:test";
import { SingleShotRuntime } from "../../src/modules/agent/application/runtime/single-shot";
import type { LlmService } from "../../src/modules/llm/application/llm.service";
import type { LoggerPort } from "../../src/shared/observability/logger.port";
import type { CompletionResponse, TokenUsage } from "../../src/modules/llm/domain/ports/llm.types";
import type { AgentDefinition, AgentSession } from "../../src/modules/agent/domain/types/agent.types";
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

const singleShotDefinition: AgentDefinition = {
  id: "single-shot-agent",
  name: "Single Shot Agent",
  description: "A single-shot agent",
  systemPrompt: "You are a single-shot agent.",
  tools: [],
  runtime: "single-shot",
};

function makeFakeLogger(): LoggerPort {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
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

describe("SingleShotRuntime", () => {
  test("completes successfully on happy path", async () => {
    const llmService = {
      complete: async () => fakeResponse({ content: "Hi there!" }),
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const session = createSession(singleShotDefinition, "Hello");
    const result = await runtime.run(session, singleShotDefinition);

    expect(result.content).toBe("Hi there!");
    expect(result.status).toBe("completed");
    expect(session.status).toBe("completed");
    expect(session.completedAt).not.toBeNull();
  });

  test("sets session status to failed on ProviderAuthError", async () => {
    const llmService = {
      complete: async () => { throw new ProviderAuthError("test"); },
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const session = createSession(singleShotDefinition, "Hello");

    await expect(runtime.run(session, singleShotDefinition)).rejects.toThrow(ProviderAuthError);
    expect(session.status).toBe("failed");
    expect(session.completedAt).not.toBeNull();
  });

  test("sets session status to failed on ProviderNotFoundError", async () => {
    const llmService = {
      complete: async () => { throw new ProviderNotFoundError("unknown"); },
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const session = createSession(singleShotDefinition, "Hello");

    await expect(runtime.run(session, singleShotDefinition)).rejects.toThrow(ProviderNotFoundError);
    expect(session.status).toBe("failed");
    expect(session.completedAt).not.toBeNull();
  });

  test("sets session status to failed on ProviderRateLimitError", async () => {
    const llmService = {
      complete: async () => { throw new ProviderRateLimitError("test", 5000); },
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const session = createSession(singleShotDefinition, "Hello");

    await expect(runtime.run(session, singleShotDefinition)).rejects.toThrow(ProviderRateLimitError);
    expect(session.status).toBe("failed");
    expect(session.completedAt).not.toBeNull();
  });

  test("sets session status to failed on non-provider errors", async () => {
    const llmService = {
      complete: async () => { throw new Error("Unexpected network failure"); },
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const session = createSession(singleShotDefinition, "Hello");

    await expect(runtime.run(session, singleShotDefinition)).rejects.toThrow("Unexpected network failure");
    expect(session.status).toBe("failed");
    expect(session.completedAt).not.toBeNull();
  });

  test("passes model override to LlmService", async () => {
    let capturedRequest: unknown;
    const llmService = {
      complete: async (req: unknown) => {
        capturedRequest = req;
        return fakeResponse();
      },
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const definitionWithModel: AgentDefinition = {
      ...singleShotDefinition,
      model: { provider: "anthropic", model: "claude-sonnet-4.5" },
    };

    const session = createSession(definitionWithModel, "Hello");
    await runtime.run(session, definitionWithModel);

    const req = capturedRequest as { provider?: string; model?: string };
    expect(req.provider).toBe("anthropic");
    expect(req.model).toBe("claude-sonnet-4.5");
  });

  test("returns reasoning from LLM response", async () => {
    const llmService = {
      complete: async () => fakeResponse({ content: "Answer", reasoning: "I thought about it" }),
    } as unknown as LlmService;

    const runtime = new SingleShotRuntime({
      llmService,
      logger: makeFakeLogger(),
    });

    const session = createSession(singleShotDefinition, "Hello");
    const result = await runtime.run(session, singleShotDefinition);

    expect(result.reasoning).toBe("I thought about it");
  });
});
