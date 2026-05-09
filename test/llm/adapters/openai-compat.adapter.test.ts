import { describe, expect, test } from "bun:test";
import { OpenAICompatAdapter } from "../../../src/modules/llm/infrastructure/providers/openai-compat.adapter";
import { ProviderAuthError, ProviderRateLimitError, ProviderApiError } from "../../../src/modules/llm/domain/errors/llm.errors";
import { makeMockResponse } from "../../helpers/mock-response";

const FAKE_API_KEY = "test-api-key";

describe("OpenAICompatAdapter", () => {
  test("complete sends correct request body", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse((init?.body as string | undefined) ?? "{}");
      requests.push({ url: String(url), body });
      return makeMockResponse({
        id: "chatcmpl-test",
        model: "gpt-4o",
        choices: [{
          message: { role: "assistant", content: "Hello" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });

    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
      maxTokens: 100,
      temperature: 0.7,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const body = requests[0]!.body;
    expect(body.model).toBe("gpt-4o");
    expect((body.messages as unknown[]).length).toBe(2);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.7);
  });

  test("strips trailing /v1 from baseUrl", async () => {
    let capturedUrl = "";
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
    });

    await adapter.complete({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  test("passes providerOptions.reasoning through", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      providerOptions: { reasoning: { effort: "high" } },
    });

    expect(capturedBody.reasoning).toEqual({ effort: "high" });
  });

  test("maps response correctly", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{
        message: { role: "assistant", content: "The capital of France is Paris." },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 9,
        total_tokens: 17,
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    const response = await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is the capital of France?" }],
    });

    expect(response.content).toBe("The capital of France is Paris.");
    expect(response.reasoning).toBe("");
    expect(response.stopReason).toBe("stop");
    expect(response.usage.inputTokens).toBe(8);
    expect(response.usage.outputTokens).toBe(9);
    expect(response.usage.reasoningTokens).toBe(3);
    expect(response.usage.totalTokens).toBe(17);
    expect(response.model).toBe("gpt-4o");
    expect(response.provider).toBe("openai");
  });

  test("maps reasoning field from message", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      model: "gpt-4o",
      choices: [{
        message: { role: "assistant", content: "Final answer.", reasoning: "Let me think..." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    const response = await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.reasoning).toBe("Let me think...");
    expect(response.content).toBe("Final answer.");
  });

  test("maps length stop reason", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      model: "gpt-4o",
      choices: [{
        message: { role: "assistant", content: "Truncated..." },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    const response = await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Count to 10000" }],
    });

    expect(response.stopReason).toBe("length");
  });

  test("throws when response has no choices", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      model: "gpt-4o",
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await expect(
      adapter.complete({ provider: "openai", model: "gpt-4o", messages: [] }),
    ).rejects.toThrow("OpenAI response has no choices");
  });

  test("throws ProviderAuthError on 401", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: { message: "Invalid API key" } }, 401);

    const adapter = new OpenAICompatAdapter({
      apiKey: "bad-key",
      baseUrl: "https://api.openai.com",
    });
    await expect(
      adapter.complete({ provider: "openai", model: "gpt-4o", messages: [] }),
    ).rejects.toThrow(ProviderAuthError);
  });

  test("throws ProviderRateLimitError on 429", async () => {
    const headers = new Headers([["retry-after", "30"]]);
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

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await expect(
      adapter.complete({ provider: "openai", model: "gpt-4o", messages: [] }),
    ).rejects.toThrow(ProviderRateLimitError);
  });

  test("throws ProviderApiError on other non-ok responses", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: "server error" }, 500);

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await expect(
      adapter.complete({ provider: "openai", model: "gpt-4o", messages: [] }),
    ).rejects.toThrow(ProviderApiError);
  });

  test("maps content_filter finish reason to error", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      model: "gpt-4o",
      choices: [{
        message: { role: "assistant", content: "" },
        finish_reason: "content_filter",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    const response = await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("error");
  });

  test("wraps network TypeError in ProviderApiError", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await expect(
      adapter.complete({ provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(ProviderApiError);
  });

  test("passes stop sequences to request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      stop: ["END", "DONE"],
    });

    expect(capturedBody.stop).toEqual(["END", "DONE"]);
  });

  test("passes topP, frequencyPenalty, presencePenalty to request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
    });

    expect(capturedBody.top_p).toBe(0.9);
    expect(capturedBody.frequency_penalty).toBe(0.5);
    expect(capturedBody.presence_penalty).toBe(0.3);
  });

  test("sends tools in request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather",
          parameters: { type: "object", properties: { location: { type: "string" } } },
        },
      ],
    });

    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe("function");
    expect((tools[0]!.function as Record<string, unknown>).name).toBe("get_weather");
    expect((tools[0]!.function as Record<string, unknown>).description).toBe("Get the weather");
    expect((tools[0]!.function as Record<string, unknown>).parameters).toEqual({
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
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedBody.tools).toBeUndefined();
  });

  test("omits description and parameters from tool when not provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{ name: "bare_tool" }],
    });

    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    const fn = tools[0]!.function as Record<string, unknown>;
    expect(fn.name).toBe("bare_tool");
    expect(fn.description).toBeUndefined();
    expect(fn.parameters).toBeUndefined();
  });

  test("maps tool_calls from response", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
          ],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    const response = await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_calls");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBe("call_abc");
    expect(response.toolCalls![0]!.type).toBe("function");
    expect(response.toolCalls![0]!.function.name).toBe("get_weather");
    expect(response.toolCalls![0]!.function.arguments).toBe('{"location":"NYC"}');
  });

  test("maps tool_calls finish reason", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      model: "gpt-4o",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "fn", arguments: "{}" } }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    const response = await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("tool_calls");
  });

  test("sends assistant message with tool_calls in request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        choices: [{ message: { role: "assistant", content: "Done" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };

    const adapter = new OpenAICompatAdapter({
      apiKey: FAKE_API_KEY,
      baseUrl: "https://api.openai.com",
    });
    await adapter.complete({
      provider: "openai",
      model: "gpt-4o",
      messages: [
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } }],
        },
        { role: "tool", content: '{"temp":72}', toolCallId: "call_abc" },
      ],
    });

    const messages = capturedBody.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(3);

    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.content).toBeNull();
    expect(messages[1]!.tool_calls).toEqual([
      { id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
    ]);

    expect(messages[2]!.role).toBe("tool");
    expect(messages[2]!.content).toBe('{"temp":72}');
    expect(messages[2]!.tool_call_id).toBe("call_abc");
  });
});
