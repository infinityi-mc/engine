/**
 * JWT scope constants for agent module endpoints.
 *
 * Tokens grant access via a space-separated `scope` claim.
 * Assign the minimum scope set needed by each client.
 */
export const SCOPES = {
  /** Run an agent session */
  AGENT_RUN: "agent:run",
  /** List and view agent definitions */
  AGENT_LIST: "agent:list",
} as const;

export type AgentScope = (typeof SCOPES)[keyof typeof SCOPES];
