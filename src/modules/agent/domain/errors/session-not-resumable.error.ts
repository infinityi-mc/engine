import type { SessionStatus } from "../types/agent.types";

export class SessionNotResumableError extends Error {
  readonly name = "SessionNotResumableError";

  constructor(
    public readonly sessionId: string,
    public readonly currentStatus: SessionStatus,
  ) {
    super(`Session ${sessionId} is not resumable (status: ${currentStatus})`);
  }
}
