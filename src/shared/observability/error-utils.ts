export function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
