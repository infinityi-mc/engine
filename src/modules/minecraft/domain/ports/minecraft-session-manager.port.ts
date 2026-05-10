import type { AgentSession } from "../../../agent/domain/types/agent.types";

export interface MinecraftSessionManagerPort {
  /** Load the active session for a server, or null if none exists yet. Handles expiry. */
  get(serverId: string): Promise<AgentSession | null>;
  /** Track a session ID for a server. */
  track(serverId: string, sessionId: string): void;
  /** Save the session after an agent run. */
  save(session: AgentSession): Promise<void>;
  /** Trim session messages to the configured cap. */
  trim(session: AgentSession): void;
}
