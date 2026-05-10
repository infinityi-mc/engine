export class SessionNotFoundError extends Error {
  readonly name = "SessionNotFoundError";

  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
  }
}
