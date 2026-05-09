import { describe, expect, test } from "bun:test";
import { AnthropicAdapter } from "../../../src/modules/llm/infrastructure/providers/anthropic.adapter";
import { ProviderAuthError, ProviderRateLimitError, ProviderApiError, ProviderTimeoutError } from "../../../src/modules/llm/domain/errors/llm.errors";
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

    const messages = capturedBody.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Hi" }] });
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

  test("maps stop_sequence stop reason to stop", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      content: [{ type: "text", text: "Done" }],
      stop_reason: "stop_sequence",
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

  test("wraps network TypeError in ProviderApiError", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "anthropic", model: "claude-sonnet-4.5", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(ProviderApiError);
  });

  test("throws ProviderTimeoutError when fetch aborts", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => { throw abortError; };

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const err = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Hi" }],
    }).catch((e: unknown) => e) as ProviderTimeoutError;
    expect(err.name).toBe("ProviderTimeoutError");
    expect(err.provider).toBe("anthropic");
    expect(err.timeoutMs).toBe(30000);
  });

  test("passes stop sequences to request body", async () => {
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
      stop: ["END", "STOP"],
    });

    expect(capturedBody.stop_sequences).toEqual(["END", "STOP"]);
  });

  test("passes topP, frequencyPenalty, presencePenalty to request body", async () => {
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
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
    });

    expect(capturedBody.top_p).toBe(0.9);
    expect(capturedBody.frequency_penalty).toBe(0.5);
    expect(capturedBody.presence_penalty).toBe(0.3);
  });

  test("sends tools in request body with input_schema", async () => {
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
      tools: [{
        name: "get_weather",
        description: "Get the weather",
        parameters: { type: "object", properties: { location: { type: "string" } } },
      }],
    });

    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("get_weather");
    expect(tools[0]!.description).toBe("Get the weather");
    expect(tools[0]!.input_schema).toEqual({
      type: "object",
      properties: { location: { type: "string" } },
    });
  });

  test("omits tools field when not provided", async () => {
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

    expect(capturedBody.tools).toBeUndefined();
  });

  test("maps tool_use content blocks from response", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_abc", name: "get_weather", input: { location: "NYC" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 15 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_calls");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBe("toolu_abc");
    expect(response.toolCalls![0]!.type).toBe("function");
    expect(response.toolCalls![0]!.function.name).toBe("get_weather");
    expect(response.toolCalls![0]!.function.arguments).toBe('{"location":"NYC"}');
  });

  test("maps tool_use stop reason", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      content: [{ type: "tool_use", id: "toolu_abc", name: "fn", input: {} }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("tool_calls");
  });

  test("sends tool result messages wrapped in user role", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        content: [{ type: "text", text: "It is 72°F." }],
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
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "toolu_abc", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } }],
        },
        { role: "tool", content: '{"temp":72}', toolCallId: "toolu_abc" },
      ],
    });

    const messages = capturedBody.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);

    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toBe("What is the weather?");

    expect(messages[1]!.role).toBe("assistant");
    const assistantContent = messages[1]!.content as Array<Record<string, unknown>>;
    expect(assistantContent).toHaveLength(1);
    expect(assistantContent[0]!.type).toBe("tool_use");
    expect(assistantContent[0]!.id).toBe("toolu_abc");
    expect(assistantContent[0]!.name).toBe("get_weather");
    expect(assistantContent[0]!.input).toEqual({ location: "NYC" });

    expect(messages[2]!.role).toBe("user");
    const toolResultContent = messages[2]!.content as Array<Record<string, unknown>>;
    expect(toolResultContent).toHaveLength(1);
    expect(toolResultContent[0]!.type).toBe("tool_result");
    expect(toolResultContent[0]!.tool_use_id).toBe("toolu_abc");
    expect(toolResultContent[0]!.content).toBe('{"temp":72}');
  });

  test("groups multiple tool results into one user message", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        content: [{ type: "text", text: "Done" }],
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
        { role: "user", content: "Check both" },
        {
          role: "assistant",
          content: null,
          toolCalls: [
            { id: "toolu_a", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
            { id: "toolu_b", type: "function", function: { name: "get_weather", arguments: '{"location":"LA"}' } },
          ],
        },
        { role: "tool", content: '{"temp":72}', toolCallId: "toolu_a" },
        { role: "tool", content: '{"temp":85}', toolCallId: "toolu_b" },
      ],
    });

    const messages = capturedBody.messages as Array<Record<string, unknown>>;
    // 3 messages: user, assistant, user (with 2 tool results)
    expect(messages).toHaveLength(3);

    const toolResultMsg = messages[2]!;
    expect(toolResultMsg.role).toBe("user");
    const toolResults = toolResultMsg.content as Array<Record<string, unknown>>;
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]!.tool_use_id).toBe("toolu_a");
    expect(toolResults[1]!.tool_use_id).toBe("toolu_b");
  });

  test("maps text and tool_use content blocks together", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "toolu_abc", name: "get_weather", input: { location: "NYC" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 15 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(response.content).toBe("Let me check.");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.function.name).toBe("get_weather");
  });

  test("throws ProviderApiError on malformed tool call arguments", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "claude-sonnet-4.5",
    });

    const adapter = new AnthropicAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        messages: [
          { role: "user", content: "Hi" },
          {
            role: "assistant",
            content: null,
            toolCalls: [{ id: "toolu_abc", type: "function", function: { name: "fn", arguments: "not-json" } }],
          },
          { role: "tool", content: '{"ok":true}', toolCallId: "toolu_abc" },
        ],
      }),
    ).rejects.toThrow(ProviderApiError);
  });
});
