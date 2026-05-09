import { describe, expect, test } from "bun:test";
import { AnthropicAdapter } from "../../../src/modules/llm/infrastructure/providers/anthropic.adapter";
import { ProviderAuthError, ProviderRateLimitError, ProviderApiError } from "../../../src/modules/llm/domain/errors/llm.errors";
import { makeMockResponse } from "../../helpers/mock-response";

const FAKE_API_KEY = "test-api-key";
const FAKE_BASE_URL = "https://api.anthropic.com";

describe("AnthropicAdapter", () => {
  test("uses default max_tokens when not provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-4.5",
      });
    };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedBody.max_tokens).toBe(4096);
  });

  test("maps system message to top-level system field", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
        model: "claude-sonnet-4.5",
      });
    };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hello" },
      ],
    });

    expect(capturedBody.system).toBe("You are a pirate.");
    expect(capturedBody.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  test("includes messages field even when only system messages are provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
        model: "claude-sonnet-4.5",
      });
    };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "system", content: "You are a helpful assistant." }],
    });

    expect(capturedBody.system).toBe("You are a helpful assistant.");
    expect(Array.isArray(capturedBody.messages)).toBe(true);
    expect((capturedBody.messages as unknown[]).length).toBe(0);
  });

  test("maps assistant message roles correctly", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-4.5",
      });
    };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
        { role: "user", content: "How are you?" },
      ],
    });

    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi" });
    expect(messages[2]).toEqual({ role: "user", content: "How are you?" });
  });

  test("passes through thinking and outputConfig providerOptions", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        content: [{ type: "text", text: "Hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
        model: "claude-sonnet-4.5",
      });
    };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Hi" }],
      providerOptions: {
        thinking: { type: "enabled", budget_tokens: 10000 },
        outputConfig: { type: "text" },
      },
    });

    expect(capturedBody.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
    expect(capturedBody.output_config).toEqual({ type: "text" });
  });

  test("maps text and thinking content blocks", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me reason through this..." },
        { type: "text", text: "The answer is 42." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 15 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "What is the answer?" }],
    });

    expect(response.content).toBe("The answer is 42.");
    expect(response.reasoning).toBe("Let me reason through this...");
    expect(response.stopReason).toBe("stop");
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(15);
    expect(response.usage.reasoningTokens).toBe(0);
    expect(response.usage.totalTokens).toBe(25);
    expect(response.model).toBe("claude-sonnet-4.5");
    expect(response.provider).toBe("anthropic");
  });

  test("maps max_tokens stop reason to length", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      content: [{ type: "text", text: "Truncated..." }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 5, output_tokens: 100 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Write a long essay" }],
    });

    expect(response.stopReason).toBe("length");
  });

  test("maps end_turn stop reason to stop", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      content: [{ type: "text", text: "Done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("stop");
  });

  test("throws ProviderAuthError on 401", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: "unauthorized" }, 401);

    const adapter = new AnthropicAdapter({ apiKey: "bad-key", baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "anthropic", model: "claude-sonnet-4.5", messages: [] }),
    ).rejects.toThrow(ProviderAuthError);
  });

  test("throws ProviderRateLimitError on 429", async () => {
    const headers = new Headers([["retry-after", "5"]]);
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => ({
      ok: false, status: 429, headers,
      json: async () => ({}),
      text: async () => "{}",
      bodyUsed: false, body: null, url: "", redirected: false,
      type: "basic" as const, statusText: "",
      clone: () => { throw new Error("not implemented"); },
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
    } as unknown as Response);

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "anthropic", model: "claude-sonnet-4.5", messages: [] }),
    ).rejects.toThrow(ProviderRateLimitError);
  });

  test("throws ProviderRateLimitError with retryAfterMs from HTTP-date header", async () => {
    const oneHourFromNow = new Date(Date.now() + 3600_000).toUTCString();
    const headers = new Headers([["retry-after", oneHourFromNow]]);
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => ({
      ok: false, status: 429, headers,
      json: async () => ({}),
      text: async () => "{}",
      bodyUsed: false, body: null, url: "", redirected: false,
      type: "basic" as const, statusText: "",
      clone: () => { throw new Error("not implemented"); },
      arrayBuffer: async () => new ArrayBuffer(0),
      blob: async () => new Blob(),
      formData: async () => new FormData(),
    } as unknown as Response);

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const err = (await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [],
    }).catch((e: unknown) => e)) as ProviderRateLimitError;
    expect(err.retryAfterMs).toBeGreaterThan(3_599_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(3_600_000);
  });

  test("throws ProviderApiError on non-ok responses", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: "bad request" }, 400);

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "anthropic", model: "claude-sonnet-4.5", messages: [] }),
    ).rejects.toThrow(ProviderApiError);
  });
});
