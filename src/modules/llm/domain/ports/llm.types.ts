export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  provider: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  providerOptions?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export type StopReason = "stop" | "length" | "error" | "unknown";

export interface CompletionResponse {
  content: string;
  reasoning: string;
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
  provider: string;
}
