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

const DEFAULT_MAX_TOKENS = 4096;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<
    | { type: "text"; text?: string }
    | { type: "thinking"; thinking?: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
}

export interface AnthropicAdapterConfig {
  apiKey: string;
  baseUrl: string;
}

export class AnthropicAdapter implements LlmProviderPort {
  constructor(private readonly config: AnthropicAdapterConfig) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(request);

    const response = await fetchWithTimeout(
      request.provider,
      `${this.config.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs,
    );

    await this.handleErrors(response, request.provider);

    const data = (await response.json()) as AnthropicResponse;

    return this.translateResponse(data, request.provider);
  }

  private buildRequestBody(request: CompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
    };

    const systemMessages = request.messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content ?? "").join("\n");
    }

    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");
    const anthropicMessages = this.buildAnthropicMessages(nonSystemMessages);
    body.messages = anthropicMessages;

    body.max_tokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }
    if (request.frequencyPenalty !== undefined) {
      body.frequency_penalty = request.frequencyPenalty;
    }
    if (request.presencePenalty !== undefined) {
      body.presence_penalty = request.presencePenalty;
    }
    if (request.stop !== undefined) {
      body.stop_sequences = request.stop;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        ...(t.parameters ? { input_schema: t.parameters } : {}),
      }));
    }

    if (request.providerOptions) {
      if (request.providerOptions["thinking"] !== undefined) {
        body.thinking = request.providerOptions["thinking"];
      }
      if (request.providerOptions["outputConfig"] !== undefined) {
        body.output_config = request.providerOptions["outputConfig"];
      }
    }

    return body;
  }

  private buildAnthropicMessages(
    messages: CompletionRequest["messages"],
  ): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "assistant") {
        const content: AnthropicContentBlock[] = [];
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            let input: Record<string, unknown>;
            try {
              input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              throw new ProviderApiError(
                "anthropic",
                0,
                `Malformed tool call arguments for ${tc.function.name}: invalid JSON`,
              );
            }
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
        }
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        if (content.length === 0) {
          content.push({ type: "text", text: "" });
        }
        result.push({ role: "assistant", content });
      } else if (msg.role === "tool") {
        if (!msg.toolCallId) {
          throw new ProviderApiError(
            "anthropic",
            0,
            "Tool result message missing required toolCallId",
          );
        }
        const toolResult: AnthropicContentBlock = {
          type: "tool_result",
          tool_use_id: msg.toolCallId,
          content: msg.content ?? "",
        };
        const prev = result[result.length - 1];
        if (prev && prev.role === "user" && Array.isArray(prev.content)) {
          prev.content.push(toolResult);
        } else {
          result.push({ role: "user", content: [toolResult] });
        }
      } else {
        result.push({ role: msg.role as "user", content: msg.content ?? "" });
      }
    }

    return result;
  }

  private translateResponse(
    data: AnthropicResponse,
    provider: string,
  ): CompletionResponse {
    let content = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === "text") {
        content += block.text ?? "";
      } else if (block.type === "thinking") {
        reasoning += block.thinking ?? "";
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    let stopReason: CompletionResponse["stopReason"] = "unknown";
    switch (data.stop_reason) {
      case "end_turn":
        stopReason = "stop";
        break;
      case "max_tokens":
        stopReason = "length";
        break;
      case "stop_sequence":
        stopReason = "stop";
        break;
      case "tool_use":
        stopReason = "tool_calls";
        break;
    }

    const usage: TokenUsage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      reasoningTokens: 0,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
    };

    return {
      content,
      reasoning,
      stopReason,
      usage,
      model: data.model,
      provider,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private async handleErrors(
    response: Response,
    provider: string,
  ): Promise<void> {
    if (response.ok) return;

    if (response.status === 401) {
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
