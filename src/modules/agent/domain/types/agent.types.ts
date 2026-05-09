import type { ChatMessage, TokenUsage } from "../../../llm/domain/ports/llm.types";

export type AgentRuntime = "tool-use-loop" | "single-shot";

export interface AgentModelConfig {
  provider: string;
  model: string;
}

export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: AgentModelConfig;
  readonly tools: readonly string[];
  readonly runtime: AgentRuntime;
  readonly maxIterations?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export type SessionStatus = "active" | "completed" | "failed" | "cancelled";

export interface AgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  messages: ChatMessage[];
  status: SessionStatus;
  readonly createdAt: number;
  completedAt: number | null;
  usage: TokenUsage;
  iterationCount: number;
}

export interface AgentRunResult {
  readonly content: string;
  readonly reasoning: string;
  readonly status: SessionStatus;
  readonly totalIterations: number;
  readonly usage: TokenUsage;
  readonly stopReason: string;
}
