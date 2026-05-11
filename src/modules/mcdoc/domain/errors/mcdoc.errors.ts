export class SchemaNotFoundError extends Error {
  readonly name = "SchemaNotFoundError";

  constructor(readonly path: string) {
    super(`mcdoc schema not found: ${path}`);
  }
}

export class UnsafeRegexError extends Error {
  readonly name = "UnsafeRegexError";

  constructor(reason: string) {
    super(`Unsafe regex pattern: ${reason}`);
  }
}
