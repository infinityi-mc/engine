export class ServerPropertiesNotFoundError extends Error {
  readonly name = "ServerPropertiesNotFoundError";

  constructor(readonly serverPath: string) {
    super(`server.properties not found in: ${serverPath}`);
  }
}
