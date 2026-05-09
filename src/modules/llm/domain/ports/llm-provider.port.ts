import type { CompletionRequest, CompletionResponse } from "./llm.types";

export interface LlmProviderPort {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
