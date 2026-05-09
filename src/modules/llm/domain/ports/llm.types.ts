export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface CompletionRequest {
  provider: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  timeoutMs?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  tools?: ToolDefinition[];
  providerOptions?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export type StopReason = "stop" | "length" | "tool_calls" | "error" | "unknown";

export interface CompletionResponse {
  content: string;
  reasoning: string;
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
  provider: string;
  toolCalls?: ToolCall[];
}
