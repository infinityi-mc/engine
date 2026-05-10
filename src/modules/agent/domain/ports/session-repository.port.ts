import type { AgentSession } from "../types/agent.types";

export interface SessionRepositoryPort {
  save(session: AgentSession): Promise<void>;
  load(sessionId: string): Promise<AgentSession | null>;
}
