import type {
  CompletionRequest,
  CompletionResponse,
  TokenUsage,
} from "../../domain/ports/llm.types";
import type { LlmProviderPort } from "../../domain/ports/llm-provider.port";
import {
  ProviderApiError,
  ProviderAuthError,
  ProviderRateLimitError,
} from "../../domain/errors/llm.errors";
import { parseRetryAfterMs } from "./shared";

const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; thinking?: string }>;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: "text" | "thinking";
    text?: string;
    thinking?: string;
  }>;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
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

    const response = await fetch(
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
      body.system = systemMessages.map((m) => m.content).join("\n");
    }

    const nonSystemMessages: AnthropicMessage[] = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    body.messages = nonSystemMessages;

    body.max_tokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
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

  private translateResponse(
    data: AnthropicResponse,
    provider: string,
  ): CompletionResponse {
    let content = "";
    let reasoning = "";

    for (const block of data.content) {
      if (block.type === "text") {
        content += block.text ?? "";
      } else if (block.type === "thinking") {
        reasoning += block.thinking ?? "";
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
