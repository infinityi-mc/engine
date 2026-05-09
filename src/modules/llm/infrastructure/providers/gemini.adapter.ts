import type {
  CompletionRequest,
  CompletionResponse,
  TokenUsage,
  ToolCall,
} from "../../domain/ports/llm.types";
import type { LlmProviderPort } from "../../domain/ports/llm-provider.port";
import {
  ProviderApiError,
  ProviderAuthError,
  ProviderRateLimitError,
} from "../../domain/errors/llm.errors";
import { parseRetryAfterMs, fetchWithTimeout } from "./shared";

interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role?: string;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

export interface GeminiAdapterConfig {
  apiKey: string;
  baseUrl: string;
}

export class GeminiAdapter implements LlmProviderPort {
  constructor(private readonly config: GeminiAdapterConfig) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(request);

    const url = `${this.config.baseUrl}/models/${request.model}:generateContent`;

    const response = await fetchWithTimeout(
      request.provider,
      url,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs,
    );

    await this.handleErrors(response, request.provider);

    const data = (await response.json()) as GeminiResponse;

    return this.translateResponse(data, request.provider, request.model);
  }

  private buildRequestBody(
    request: CompletionRequest,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    const systemMessages = request.messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      body.systemInstruction = {
        parts: systemMessages.map((m) => ({ text: m.content ?? "" })),
      };
    }

    const nonSystemMessages = request.messages.filter(
      (m) => m.role !== "system",
    );

    const contents: GeminiContent[] = [];
    for (const msg of nonSystemMessages) {
      if (msg.role === "assistant") {
        const parts: GeminiPart[] = [];
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            let args: Record<string, unknown>;
            try {
              args = JSON.parse(tc.function.arguments) as Record<
                string,
                unknown
              >;
            } catch {
              throw new ProviderApiError(
                request.provider,
                0,
                `Malformed tool call arguments for ${tc.function.name}: invalid JSON`,
              );
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
              ...(tc.thoughtSignature
                ? { thoughtSignature: tc.thoughtSignature }
                : {}),
            });
          }
        }
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        contents.push({ role: "model", parts });
      } else if (msg.role === "tool") {
        const functionName = msg.toolName ?? msg.toolCallId;
        if (!functionName) {
          throw new ProviderApiError(
            request.provider,
            0,
            "Tool result message missing required toolName or toolCallId",
          );
        }
        let response: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(msg.content ?? "{}");
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
          ) {
            response = parsed as Record<string, unknown>;
          } else {
            response = { result: parsed };
          }
        } catch {
          response = { result: msg.content ?? "" };
        }
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: functionName,
                response,
              },
            },
          ],
        });
      } else {
        contents.push({
          role: "user",
          parts: [{ text: msg.content ?? "" }],
        });
      }
    }

    if (contents.length > 0) {
      body.contents = contents;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            ...(t.parameters ? { parameters: t.parameters } : {}),
          })),
        },
      ];
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      generationConfig.topP = request.topP;
    }
    if (request.stop !== undefined) {
      generationConfig.stopSequences = request.stop;
    }
    if (request.providerOptions) {
      if (request.providerOptions["thinkingConfig"] !== undefined) {
        generationConfig.thinkingConfig =
          request.providerOptions["thinkingConfig"];
      }
    }
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return body;
  }

  private translateResponse(
    data: GeminiResponse,
    provider: string,
    requestedModel: string,
  ): CompletionResponse {
    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new ProviderApiError(
        provider,
        200,
        "Gemini response has no candidates",
      );
    }
    const parts = candidate?.content?.parts ?? [];

    let content = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id ?? crypto.randomUUID(),
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          },
          ...(part.thoughtSignature
            ? { thoughtSignature: part.thoughtSignature }
            : {}),
        });
      } else if (part.thought) {
        reasoning += part.text ?? "";
      } else {
        content += part.text ?? "";
      }
    }

    let stopReason: CompletionResponse["stopReason"] = "unknown";
    switch (candidate?.finishReason) {
      case "STOP":
        stopReason = toolCalls.length > 0 ? "tool_calls" : "stop";
        break;
      case "MAX_TOKENS":
        stopReason = "length";
        break;
      case "SAFETY":
      case "BLOCKED":
        stopReason = "error";
        break;
    }

    const usage: TokenUsage = {
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      reasoningTokens: data.usageMetadata?.thoughtsTokenCount ?? 0,
      totalTokens:
        (data.usageMetadata?.promptTokenCount ?? 0) +
        (data.usageMetadata?.candidatesTokenCount ?? 0) +
        (data.usageMetadata?.thoughtsTokenCount ?? 0),
    };

    return {
      content,
      reasoning,
      stopReason,
      usage,
      model: data.modelVersion ?? requestedModel,
      provider,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private async handleErrors(
    response: Response,
    provider: string,
  ): Promise<void> {
    if (response.ok) return;

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthError(provider);
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      throw new ProviderRateLimitError(provider, retryAfterMs);
    }

    const body = await response.text();
    throw new ProviderApiError(provider, response.status, body);
  }
}
