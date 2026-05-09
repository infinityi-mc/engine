import { describe, expect, test } from "bun:test";
import { GeminiAdapter } from "../../../src/modules/llm/infrastructure/providers/gemini.adapter";
import { ProviderAuthError, ProviderRateLimitError, ProviderApiError, ProviderTimeoutError } from "../../../src/modules/llm/domain/errors/llm.errors";
import { makeMockResponse } from "../../helpers/mock-response";

const FAKE_API_KEY = "test-api-key";
const FAKE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

describe("GeminiAdapter", () => {
  test("builds correct URL with model in path", async () => {
    let capturedUrl = "";
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return makeMockResponse({
        candidates: [{
          content: { parts: [{ text: "Hello" }] },
          finishReason: "STOP",
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
  });

  test("maps system message to systemInstruction", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{
          content: { parts: [{ text: "Ahoy!" }] },
          finishReason: "STOP",
        }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hello" },
      ],
    });

    expect(capturedBody.systemInstruction).toEqual({
      parts: [{ text: "You are a pirate." }],
    });
    const contents = capturedBody.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(contents[0]!.role).toBe("user");
    expect(contents[0]!.parts[0]!.text).toBe("Hello");
  });

  test("maps assistant role to model", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{
          content: { parts: [{ text: "Hi" }] },
          finishReason: "STOP",
        }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    });

    const contents = capturedBody.contents as Array<{ role: string }>;
    expect(contents[0]!.role).toBe("user");
    expect(contents[1]!.role).toBe("model");
  });

  test("maps maxTokens to generationConfig.maxOutputTokens", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 256,
    });

    const genConfig = capturedBody.generationConfig as Record<string, unknown>;
    expect(genConfig.maxOutputTokens).toBe(256);
  });

  test("passes through thinkingConfig providerOptions", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
      providerOptions: { thinkingConfig: { thinkingBudget: 1024 } },
    });

    const genConfig = capturedBody.generationConfig as Record<string, unknown>;
    expect(genConfig.thinkingConfig).toEqual({ thinkingBudget: 1024 });
  });

  test("maps response with thought parts as reasoning", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: {
          parts: [
            { thought: true, text: "I should calculate this..." },
            { text: "The answer is 42." },
          ],
        },
        finishReason: "STOP",
      }],
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 2,
      },
      modelVersion: "gemini-2.0-flash",
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "What is 6 * 7?" }],
    });

    expect(response.content).toBe("The answer is 42.");
    expect(response.reasoning).toBe("I should calculate this...");
    expect(response.stopReason).toBe("stop");
    expect(response.usage.inputTokens).toBe(8);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.usage.reasoningTokens).toBe(2);
    expect(response.usage.totalTokens).toBe(15);
    expect(response.model).toBe("gemini-2.0-flash");
    expect(response.provider).toBe("google");
  });

  test("maps MAX_TOKENS finish reason to length", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: { parts: [{ text: "Truncated..." }] },
        finishReason: "MAX_TOKENS",
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Write a long essay" }],
    });

    expect(response.stopReason).toBe("length");
  });

  test("maps STOP finish reason to stop", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: { parts: [{ text: "Done" }] },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("stop");
  });

  test("throws ProviderAuthError on 401 and 403", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: "unauthorized" }, 401);

    const adapter = new GeminiAdapter({ apiKey: "bad-key", baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "google", model: "gemini-2.0-flash", messages: [] }),
    ).rejects.toThrow(ProviderAuthError);

    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: "forbidden" }, 403);

    await expect(
      adapter.complete({ provider: "google", model: "gemini-2.0-flash", messages: [] }),
    ).rejects.toThrow(ProviderAuthError);
  });

  test("throws ProviderRateLimitError on 429", async () => {
    const headers = new Headers([["retry-after", "10"]]);
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

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "google", model: "gemini-2.0-flash", messages: [] }),
    ).rejects.toThrow(ProviderRateLimitError);
  });

  test("throws ProviderApiError on non-ok responses", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({ error: "bad request" }, 400);

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "google", model: "gemini-2.0-flash", messages: [] }),
    ).rejects.toThrow(ProviderApiError);
  });

  test("throws ProviderApiError when candidates array is empty", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const err = (await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    }).catch((e: unknown) => e)) as ProviderApiError;
    expect(err.statusCode).toBe(200);
    expect(err.responseBody).toContain("Gemini response has no candidates");
  });

  test("maps SAFETY finish reason to error", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: { parts: [{ text: "" }] },
        finishReason: "SAFETY",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("error");
  });

  test("uses modelVersion from response, falls back to requested model", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: { parts: [{ text: "Hello" }] },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      modelVersion: "gemini-2.0-flash-001",
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.model).toBe("gemini-2.0-flash-001");
  });

  test("wraps network TypeError in ProviderApiError", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({ provider: "google", model: "gemini-2.0-flash", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow(ProviderApiError);
  });

  test("passes stop sequences to generationConfig", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
      stop: ["END", "DONE"],
    });

    const genConfig = capturedBody.generationConfig as Record<string, unknown>;
    expect(genConfig.stopSequences).toEqual(["END", "DONE"]);
  });

  test("passes topP to generationConfig", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
      topP: 0.8,
    });

    const genConfig = capturedBody.generationConfig as Record<string, unknown>;
    expect(genConfig.topP).toBe(0.8);
  });

  test("sends tools as functionDeclarations in request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{
        name: "get_weather",
        description: "Get the weather",
        parameters: { type: "object", properties: { location: { type: "string" } } },
      }],
    });

    const tools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    const decls = tools[0]!.functionDeclarations as Array<Record<string, unknown>>;
    expect(decls).toHaveLength(1);
    expect(decls[0]!.name).toBe("get_weather");
    expect(decls[0]!.description).toBe("Get the weather");
    expect(decls[0]!.parameters).toEqual({
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
        candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(capturedBody.tools).toBeUndefined();
  });

  test("maps functionCall parts from response", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: {
          parts: [{ functionCall: { name: "get_weather", args: { location: "NYC" } } }],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_calls");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBeTruthy();
    expect(typeof response.toolCalls![0]!.id).toBe("string");
    expect(response.toolCalls![0]!.type).toBe("function");
    expect(response.toolCalls![0]!.function.name).toBe("get_weather");
    expect(response.toolCalls![0]!.function.arguments).toBe('{"location":"NYC"}');
  });

  test("generates unique IDs for each function call", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: "fn_a", args: {} } },
            { functionCall: { name: "fn_b", args: {} } },
          ],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls![0]!.id).not.toBe(response.toolCalls![1]!.id);
    expect(response.toolCalls![0]!.function.name).toBe("fn_a");
    expect(response.toolCalls![1]!.function.name).toBe("fn_b");
  });

  test("maps functionResponse parts for tool messages", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "It is 72°F." }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } }],
        },
        { role: "tool", content: '{"temp":72}', toolCallId: "call_abc", toolName: "get_weather" },
      ],
    });

    const contents = capturedBody.contents as Array<Record<string, unknown>>;
    expect(contents).toHaveLength(3);

    expect(contents[0]!.role).toBe("user");

    expect(contents[1]!.role).toBe("model");
    const modelParts = contents[1]!.parts as Array<Record<string, unknown>>;
    expect(modelParts[0]!.functionCall).toEqual({ name: "get_weather", args: { location: "NYC" } });

    expect(contents[2]!.role).toBe("user");
    const toolParts = contents[2]!.parts as Array<Record<string, unknown>>;
    expect(toolParts[0]!.functionResponse).toEqual({ name: "get_weather", response: { temp: 72 } });
  });

  test("maps functionCall to tool_calls stop reason", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: { parts: [{ functionCall: { name: "fn", args: {} } }] },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.stopReason).toBe("tool_calls");
  });

  test("maps text and functionCall parts together", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: {
          parts: [
            { text: "Let me check." },
            { functionCall: { name: "get_weather", args: { location: "NYC" } } },
          ],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(response.content).toBe("Let me check.");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.function.name).toBe("get_weather");
  });

  test("uses API-returned functionCall ID when present", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: {
          parts: [{ functionCall: { id: "gemini-call-123", name: "get_weather", args: { location: "NYC" } } }],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBe("gemini-call-123");
  });

  test("falls back to generated UUID when functionCall ID is absent", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{
        content: {
          parts: [{ functionCall: { name: "fn", args: {} } }],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    const response = await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBeTruthy();
    expect(typeof response.toolCalls![0]!.id).toBe("string");
    expect(response.toolCalls![0]!.id.length).toBeGreaterThan(0);
  });

  test("throws ProviderApiError on malformed tool call arguments", async () => {
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async () => makeMockResponse({
      candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await expect(
      adapter.complete({
        provider: "google",
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hi" },
          {
            role: "assistant",
            content: null,
            toolCalls: [{ id: "call_1", type: "function", function: { name: "fn", arguments: "not-json" } }],
          },
          { role: "tool", content: '{"ok":true}', toolCallId: "call_1", toolName: "fn" },
        ],
      }),
    ).rejects.toThrow(ProviderApiError);
  });

  test("wraps non-JSON tool result content as { result: string }", async () => {
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore - mock fetch for testing
    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse((init?.body as string | undefined) ?? "{}");
      return makeMockResponse({
        candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      });
    };

    const adapter = new GeminiAdapter({ apiKey: FAKE_API_KEY, baseUrl: FAKE_BASE_URL });
    await adapter.complete({
      provider: "google",
      model: "gemini-2.0-flash",
      messages: [
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_1", type: "function", function: { name: "fn", arguments: '{}' } }],
        },
        { role: "tool", content: 'plain text result', toolCallId: "call_1", toolName: "fn" },
      ],
    });

    const contents = capturedBody.contents as Array<Record<string, unknown>>;
    const toolParts = contents[2]!.parts as Array<Record<string, unknown>>;
    expect(toolParts[0]!.functionResponse).toEqual({
      name: "fn",
      response: { result: "plain text result" },
    });
  });
});
