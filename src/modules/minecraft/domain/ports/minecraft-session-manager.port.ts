import type { AgentSession } from "../../../agent/domain/types/agent.types";

export interface MinecraftSessionManagerPort {
  /** Load the active session for a server+agent, or null if none exists yet. Handles expiry. */
  get(serverId: string, agentId: string): Promise<AgentSession | null>;
  /** Track a session ID for a server+agent. */
  track(serverId: string, agentId: string, sessionId: string): void;
  /** Save the session after an agent run. */
  save(session: AgentSession): Promise<void>;
  /** Trim session messages to the configured cap. */
  trim(session: AgentSession): void;
}
