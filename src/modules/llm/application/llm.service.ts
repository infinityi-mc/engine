import type {
  CompletionRequest,
  CompletionResponse,
} from "../domain/ports/llm.types";
import type { LlmProviderPort } from "../domain/ports/llm-provider.port";
import type { ConfigPort } from "../../../shared/config/config.port";
import type { LoggerPort } from "../../../shared/observability/logger.port";
import { ProviderNotFoundError } from "../domain/errors/llm.errors";

export class LlmService {
  constructor(
    private readonly providers: Map<string, LlmProviderPort>,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async complete(
    request: Omit<CompletionRequest, "provider" | "model"> & {
      provider?: string;
      model?: string;
    },
  ): Promise<CompletionResponse> {
    const llmConfig = this.config.getLlmConfig();

    const resolvedProvider =
      request.provider ?? llmConfig.defaultProvider;
    const resolvedModel = request.model ?? llmConfig.defaultModel;

    const adapter = this.providers.get(resolvedProvider);
    if (!adapter) {
      throw new ProviderNotFoundError(resolvedProvider);
    }

    const fullRequest: CompletionRequest = {
      provider: resolvedProvider,
      model: resolvedModel,
      messages: request.messages,
    };

    if (request.maxTokens !== undefined) {
      fullRequest.maxTokens = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      fullRequest.temperature = request.temperature;
    }
    if (request.providerOptions !== undefined) {
      fullRequest.providerOptions = request.providerOptions;
    }

    const response = await adapter.complete(fullRequest);

    this.logger.info("LLM completion", {
      provider: resolvedProvider,
      model: resolvedModel,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      reasoningTokens: response.usage.reasoningTokens,
      totalTokens: response.usage.totalTokens,
    });

    return response;
  }
}
