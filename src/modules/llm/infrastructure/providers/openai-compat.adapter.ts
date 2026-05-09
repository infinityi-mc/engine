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

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatCompletionsResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null; reasoning?: string | null };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  model: string;
}

export interface OpenAICompatAdapterConfig {
  apiKey: string;
  baseUrl: string;
}

export class OpenAICompatAdapter implements LlmProviderPort {
  constructor(private readonly config: OpenAICompatAdapterConfig) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildRequestBody(request);

    const baseUrl = this.config.baseUrl.replace(/\/v1\/?$/, "");

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    await this.handleErrors(response, request.provider);

    const data = (await response.json()) as OpenAIChatCompletionsResponse;

    return this.translateResponse(data, request.provider);
  }

  private buildRequestBody(request: CompletionRequest): Record<string, unknown> {
    const messages: OpenAIChatMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
    };

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.providerOptions) {
      if (request.providerOptions["reasoning"] !== undefined) {
        body.reasoning = request.providerOptions["reasoning"];
      }
    }

    return body;
  }

  private translateResponse(
    data: OpenAIChatCompletionsResponse,
    provider: string,
  ): CompletionResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("OpenAI response has no choices");
    }
    const usage = data.usage;

    const reasoningTokens =
      usage.completion_tokens_details?.reasoning_tokens ?? 0;

    const tokenUsage: TokenUsage = {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      reasoningTokens,
      totalTokens: usage.total_tokens,
    };

    let stopReason: CompletionResponse["stopReason"] = "unknown";
    switch (choice.finish_reason) {
      case "stop":
        stopReason = "stop";
        break;
      case "length":
        stopReason = "length";
        break;
    }

    return {
      content: choice.message.content ?? "",
      reasoning: choice.message.reasoning ?? "",
      stopReason,
      usage: tokenUsage,
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
