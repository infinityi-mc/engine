import type { MinecraftSessionManagerPort } from "../../../minecraft/domain/ports/minecraft-session-manager.port";
import type { SessionRepositoryPort } from "../../domain/ports/session-repository.port";
import type { AgentSession } from "../../domain/types/agent.types";

export interface MinecraftSessionManagerAdapterDeps {
  readonly sessionRepository: SessionRepositoryPort;
  readonly messageCap: number;
  readonly sessionTtlMs: number;
}

export class MinecraftSessionManagerAdapter implements MinecraftSessionManagerPort {
  private readonly serverSessions = new Map<string, string>();
  private readonly lastActivity = new Map<string, number>();

  constructor(private readonly deps: MinecraftSessionManagerAdapterDeps) {}

  private sessionKey(serverId: string, agentId: string): string {
    return `${serverId}:${agentId}`;
  }

  async get(serverId: string, agentId: string): Promise<AgentSession | null> {
    const key = this.sessionKey(serverId, agentId);
    const sessionId = this.serverSessions.get(key);
    if (sessionId === undefined) return null;

    const lastActive = this.lastActivity.get(key);
    if (lastActive !== undefined && Date.now() - lastActive >= this.deps.sessionTtlMs) {
      this.serverSessions.delete(key);
      this.lastActivity.delete(key);
      return null;
    }

    const session = await this.deps.sessionRepository.load(sessionId);
    if (session === null) {
      this.serverSessions.delete(key);
      this.lastActivity.delete(key);
      return null;
    }

    return session;
  }

  track(serverId: string, agentId: string, sessionId: string): void {
    const key = this.sessionKey(serverId, agentId);
    this.serverSessions.set(key, sessionId);
    this.lastActivity.set(key, Date.now());
  }

  async save(session: AgentSession): Promise<void> {
    await this.deps.sessionRepository.save(session);
  }

  trim(session: AgentSession): void {
    const cap = this.deps.messageCap;
    if (session.messages.length <= cap) return;

    const systemMessages = session.messages.filter((m) => m.role === "system");
    const nonSystemMessages = session.messages.filter((m) => m.role !== "system");
    const trimmed = nonSystemMessages.slice(-cap);
    session.messages.splice(0, session.messages.length, ...systemMessages, ...trimmed);
  }
}
