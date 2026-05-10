import type { EventBus } from "../../../../shared/application/event-bus";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { LogListenerPort } from "../../domain/ports/log-listener.port";
import type { MinecraftLogPort } from "../../domain/ports/minecraft-log.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { PatternRegistryPort } from "../../domain/ports/pattern-registry.port";
import { MinecraftLogPatternMatched } from "../../domain/events/minecraft-log-pattern-matched.event";

const CHAT_PREFIX_RE = /]:\s*<(.+?)>\s*(.*)/;

interface ServerTeamConfig {
  readonly prefixes: readonly string[];
  readonly suffixes: readonly string[];
}

export class MinecraftLogListener implements LogListenerPort {
  private readonly unsubs = new Map<string, () => void>();
  private readonly teamConfigs = new Map<string, ServerTeamConfig>();

  constructor(
    private readonly logPort: MinecraftLogPort,
    private readonly patternRegistry: PatternRegistryPort,
    private readonly eventBus: EventBus,
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly logger: LoggerPort,
  ) {}

  async startListening(serverId: string): Promise<void> {
    if (this.unsubs.has(serverId)) return;

    const server = await this.repository.get(serverId);
    if (server !== undefined) {
      this.teamConfigs.set(serverId, {
        prefixes: server.players?.teams?.prefix ?? [],
        suffixes: server.players?.teams?.suffix ?? [],
      });
    }

    const unsub = this.logPort.onLogLine(serverId, (line) => {
      this.processLine(serverId, line);
    });

    this.unsubs.set(serverId, unsub);
    this.logger.info("minecraft.log_listener.started", {
      module: "minecraft",
      operation: "log_listener.start",
      serverId,
    });
  }

  stopListening(serverId: string): void {
    const unsub = this.unsubs.get(serverId);
    if (unsub) {
      unsub();
      this.unsubs.delete(serverId);
      this.teamConfigs.delete(serverId);
      this.logger.info("minecraft.log_listener.stopped", {
        module: "minecraft",
        operation: "log_listener.stop",
        serverId,
      });
    }
  }

  private processLine(serverId: string, line: string): void {
    const chatMatch = CHAT_PREFIX_RE.exec(line);
    if (!chatMatch) return;

    const rawContent = chatMatch[1]!;
    const message = chatMatch[2]!;

    const playerName = this.resolvePlayerName(serverId, rawContent);

    const match = this.patternRegistry.match(message);
    if (!match) return;

    const event = new MinecraftLogPatternMatched(
      serverId,
      playerName,
      message,
      match.pattern,
      match.metadata.action,
      match.metadata.payload,
    );

    this.logger.info("minecraft.log_listener.pattern_matched", {
      module: "minecraft",
      operation: "log_listener.match",
      serverId,
      playerName,
      pattern: match.pattern,
      action: match.metadata.action,
    });

    this.eventBus.publish(event).catch((error) => {
      this.logger.warn("minecraft.log_listener.publish_failed", {
        module: "minecraft",
        operation: "log_listener.publish",
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private resolvePlayerName(serverId: string, rawContent: string): string {
    const config = this.teamConfigs.get(serverId);
    if (config === undefined) return rawContent;

    let name = rawContent;

    for (const prefix of config.prefixes) {
      if (name.startsWith(prefix)) {
        name = name.slice(prefix.length);
        break;
      }
    }

    for (const suffix of config.suffixes) {
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        break;
      }
    }

    return name;
  }
}
