/**
 * JWT scope constants for server module endpoints.
 *
 * Tokens grant access via a space-separated `scope` claim.
 * Assign the minimum scope set needed by each client.
 */
export const SCOPES = {
  /** Read-only server operations: list instances, get status */
  INSTANCE_READ: "server:instance:read",
  /** Mutating server operations: spawn, kill */
  INSTANCE_WRITE: "server:instance:write",
} as const;

export type ServerScope = (typeof SCOPES)[keyof typeof SCOPES];
