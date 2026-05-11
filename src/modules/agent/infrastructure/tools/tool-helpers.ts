import type { ToolResult } from "../../domain/types/tool.types";

export function toolError(message: string): ToolResult {
  return { output: message, isError: true };
}

export function jsonOk(value: unknown): ToolResult {
  return { output: JSON.stringify(value), isError: false };
}

export function asObject(
  input: unknown,
): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}
