export class ServerNotFoundError extends Error {
  readonly name = "ServerNotFoundError";

  constructor(readonly instanceId: string) {
    super(`Server instance not found: ${instanceId}`);
  }
}
