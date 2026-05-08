export class ServerAlreadyExistsError extends Error {
  readonly name = "ServerAlreadyExistsError";

  constructor(readonly instanceId: string) {
    super(`Server instance already exists: ${instanceId}`);
  }
}
