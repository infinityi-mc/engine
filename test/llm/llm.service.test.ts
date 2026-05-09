import { describe, expect, test } from "bun:test";
import { LlmService } from "../../src/modules/llm/application/llm.service";
import { ProviderNotFoundError } from "../../src/modules/llm/domain/errors/llm.errors";
import type { LlmProviderPort } from "../../src/modules/llm/domain/ports/llm-provider.port";
import type { ConfigPort } from "../../src/shared/config/config.port";
import type { LoggerPort } from "../../src/shared/observability/logger.port";
import type { CompletionRequest, CompletionResponse } from "../../src/modules/llm/domain/ports/llm.types";

const fakeResponse = (overrides?: Partial<CompletionResponse>): CompletionResponse => ({
  content: "test response",
  reasoning: "",
  stopReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
  model: "test-model",
  provider: "test",
  ...overrides,
});

function makeFakeConfig(defaultProvider = "openai", defaultModel = "gpt-4o"): ConfigPort {
  return {
    getConfig: () => ({ llm: { defaultProvider, defaultModel, providers: {} } }),
    getLlmConfig: () => ({ defaultProvider, defaultModel, providers: {} }),
    getAgentConfig: () => undefined,
    getApiKey: () => "",
    getBaseUrl: () => "",
    onChange: () => () => {},
    stop: () => {},
  };
}

function makeFakeLogger(): LoggerPort {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("LlmService", () => {
  test("uses request provider and model when provided", async () => {
    const mockAdapter: LlmProviderPort = {
      complete: async (req: CompletionRequest) => fakeResponse({ provider: req.provider, model: req.model }),
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), makeFakeLogger());

    const response = await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-4o");
  });

  test("falls back to config defaults when provider/model not provided", async () => {
    const mockAdapter: LlmProviderPort = {
      complete: async (req: CompletionRequest) => fakeResponse({ provider: req.provider, model: req.model }),
    };

    const providers = new Map([["anthropic", mockAdapter]]);
    const config = makeFakeConfig("anthropic", "claude-sonnet-4.5");
    const service = new LlmService(providers, config, makeFakeLogger());

    const response = await service.complete({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.provider).toBe("anthropic");
    expect(response.model).toBe("claude-sonnet-4.5");
  });

  test("passes through maxTokens, temperature, and providerOptions", async () => {
    let capturedRequest: CompletionRequest | null = null;
    const mockAdapter: LlmProviderPort = {
      complete: async (req: CompletionRequest) => {
        capturedRequest = req;
        return fakeResponse();
      },
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), makeFakeLogger());

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 100,
      temperature: 0.5,
      providerOptions: { thinking: { type: "enabled", budget_tokens: 10000 } },
    });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.maxTokens).toBe(100);
    expect(capturedRequest!.temperature).toBe(0.5);
    expect(capturedRequest!.providerOptions).toEqual({ thinking: { type: "enabled", budget_tokens: 10000 } });
  });

  test("throws ProviderNotFoundError when provider is not registered", async () => {
    const providers = new Map<string, LlmProviderPort>();
    const service = new LlmService(providers, makeFakeConfig("unknown", "model"), makeFakeLogger());

    await expect(
      service.complete({ messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(ProviderNotFoundError);
  });

  test("logs completion with token usage", async () => {
    const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
    const logger: LoggerPort = {
      debug: () => {},
      info: (msg: string, ctx: Record<string, unknown>) => { logs.push({ message: msg, context: ctx }); },
      warn: () => {},
      error: () => {},
    };

    const mockAdapter: LlmProviderPort = {
      complete: async () => fakeResponse({
        usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5, totalTokens: 35 },
      }),
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), logger);

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.message).toBe("LLM completion");
    expect(logs[0]!.context).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 5,
      totalTokens: 35,
    });
  });

  test("delegates to the correct adapter by provider name", async () => {
    const callOrder: string[] = [];
    const mockAnthropic: LlmProviderPort = {
      complete: async (req: CompletionRequest) => { callOrder.push(req.provider); return fakeResponse(); },
    };
    const mockOpenAI: LlmProviderPort = {
      complete: async (req: CompletionRequest) => { callOrder.push(req.provider); return fakeResponse(); },
    };

    const providers = new Map([
      ["anthropic", mockAnthropic],
      ["openai", mockOpenAI],
    ]);
    const service = new LlmService(providers, makeFakeConfig("openai", "gpt-4o"), makeFakeLogger());

    await service.complete({ messages: [{ role: "user", content: "Hi" }] });
    expect(callOrder).toEqual(["openai"]);

    await service.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(callOrder).toEqual(["openai", "anthropic"]);
  });

  test("throws when messages array is empty", async () => {
    const mockAdapter: LlmProviderPort = {
      complete: async () => fakeResponse(),
    };
    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), makeFakeLogger());

    await expect(
      service.complete({ messages: [] }),
    ).rejects.toThrow("messages array cannot be empty");
  });

  test("logs completion with durationMs", async () => {
    const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
    const logger: LoggerPort = {
      debug: () => {},
      info: (msg: string, ctx: Record<string, unknown>) => { logs.push({ message: msg, context: ctx }); },
      warn: () => {},
      error: () => {},
    };

    const mockAdapter: LlmProviderPort = {
      complete: async () => fakeResponse({
        usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5, totalTokens: 35 },
      }),
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), logger);

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.message).toBe("LLM completion");
    expect(typeof logs[0]!.context.durationMs).toBe("number");
    expect(logs[0]!.context.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("passes stop, timeoutMs, topP, frequencyPenalty, presencePenalty through to adapter", async () => {
    let capturedRequest: CompletionRequest | null = null;
    const mockAdapter: LlmProviderPort = {
      complete: async (req: CompletionRequest) => {
        capturedRequest = req;
        return fakeResponse();
      },
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), makeFakeLogger());

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      stop: ["END"],
      timeoutMs: 60_000,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
    });

    expect(capturedRequest!.stop).toEqual(["END"]);
    expect(capturedRequest!.timeoutMs).toBe(60_000);
    expect(capturedRequest!.topP).toBe(0.9);
    expect(capturedRequest!.frequencyPenalty).toBe(0.5);
    expect(capturedRequest!.presencePenalty).toBe(0.3);
  });

  test("passes tools through to adapter", async () => {
    let capturedRequest: CompletionRequest | null = null;
    const mockAdapter: LlmProviderPort = {
      complete: async (req: CompletionRequest) => {
        capturedRequest = req;
        return fakeResponse();
      },
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), makeFakeLogger());

    const tools = [
      { name: "get_weather", description: "Get weather", parameters: { type: "object" as const, properties: {} } },
    ];

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      tools,
    });

    expect(capturedRequest!.tools).toEqual(tools);
  });

  test("omits tools from request when not provided", async () => {
    let capturedRequest: CompletionRequest | null = null;
    const mockAdapter: LlmProviderPort = {
      complete: async (req: CompletionRequest) => {
        capturedRequest = req;
        return fakeResponse();
      },
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), makeFakeLogger());

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedRequest!.tools).toBeUndefined();
  });

  test("logs tool call count when response has tool calls", async () => {
    const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
    const logger: LoggerPort = {
      debug: () => {},
      info: (msg: string, ctx: Record<string, unknown>) => { logs.push({ message: msg, context: ctx }); },
      warn: () => {},
      error: () => {},
    };

    const mockAdapter: LlmProviderPort = {
      complete: async () => fakeResponse({
        toolCalls: [
          { id: "call_1", type: "function", function: { name: "fn", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "fn2", arguments: "{}" } },
        ],
      }),
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), logger);

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.context.toolCallCount).toBe(2);
  });

  test("does not log toolCallCount when response has no tool calls", async () => {
    const logs: Array<{ message: string; context: Record<string, unknown> }> = [];
    const logger: LoggerPort = {
      debug: () => {},
      info: (msg: string, ctx: Record<string, unknown>) => { logs.push({ message: msg, context: ctx }); },
      warn: () => {},
      error: () => {},
    };

    const mockAdapter: LlmProviderPort = {
      complete: async () => fakeResponse(),
    };

    const providers = new Map([["openai", mockAdapter]]);
    const service = new LlmService(providers, makeFakeConfig(), logger);

    await service.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.context.toolCallCount).toBeUndefined();
  });
});
