export class UnsupportedToolError extends Error {
  readonly name = "UnsupportedToolError";

  constructor(readonly tool: string) {
    super(`${tool} is not available in this environment`);
  }
}
