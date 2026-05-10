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

  async get(serverId: string): Promise<AgentSession | null> {
    const sessionId = this.serverSessions.get(serverId);
    if (sessionId === undefined) return null;

    const lastActive = this.lastActivity.get(serverId);
    if (lastActive !== undefined && Date.now() - lastActive >= this.deps.sessionTtlMs) {
      this.serverSessions.delete(serverId);
      this.lastActivity.delete(serverId);
      return null;
    }

    const session = await this.deps.sessionRepository.load(sessionId);
    if (session === null) {
      this.serverSessions.delete(serverId);
      this.lastActivity.delete(serverId);
      return null;
    }

    return session;
  }

  track(serverId: string, sessionId: string): void {
    this.serverSessions.set(serverId, sessionId);
    this.lastActivity.set(serverId, Date.now());
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
