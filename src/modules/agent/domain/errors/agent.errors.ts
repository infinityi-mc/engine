import type { AgentRunResult } from "../types/agent.types";

export class AgentNotFoundError extends Error {
  readonly name = "AgentNotFoundError";

  constructor(public readonly agentId: string) {
    super(`Agent not found: ${agentId}`);
  }
}

export class MaxIterationsReachedError extends Error {
  readonly name = "MaxIterationsReachedError";

  constructor(
    public readonly maxIterations: number,
    public readonly partialResult: AgentRunResult,
  ) {
    super(`Agent reached maximum iterations (${maxIterations})`);
  }
}

export class SessionTimeoutError extends Error {
  readonly name = "SessionTimeoutError";

  constructor(
    public readonly timeoutMs: number,
    public readonly partialResult: AgentRunResult,
  ) {
    super(`Agent session timed out after ${timeoutMs}ms`);
  }
}
