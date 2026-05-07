export class ClientInputError extends Error {
  readonly name = "ClientInputError";

  constructor(message: string) {
    super(message);
  }
}
