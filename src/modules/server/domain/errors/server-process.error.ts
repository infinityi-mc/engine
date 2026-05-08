export class ServerProcessError extends Error {
  readonly name = "ServerProcessError";

  constructor(
    readonly instanceId: string,
    message: string,
  ) {
    super(`Server process error for ${instanceId}: ${message}`);
  }
}
