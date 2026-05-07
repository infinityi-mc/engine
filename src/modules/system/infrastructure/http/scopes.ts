/**
 * JWT scope constants for system module endpoints.
 *
 * Tokens grant access via a space-separated `scope` claim.
 * Assign the minimum scope set needed by each client.
 */
export const SCOPES = {
  /** Read-only file operations: glob, grep, list, read, awk */
  FILES_READ: "system:files:read",
  /** Mutating file operations: move, copy, delete, sed */
  FILES_WRITE: "system:files:write",
  /** Terminal command execution (RCE — grant with extreme caution) */
  TERMINAL_EXECUTE: "system:terminal:execute",
} as const;

export type SystemScope = (typeof SCOPES)[keyof typeof SCOPES];
