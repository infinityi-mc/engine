import type { CompletionRequest, CompletionResponse } from "../../../llm/domain/ports/llm.types";

export interface McdocLlmPort {
  complete(request: Omit<CompletionRequest, "provider" | "model"> & {
    provider?: string;
    model?: string;
  }): Promise<CompletionResponse>;
}
