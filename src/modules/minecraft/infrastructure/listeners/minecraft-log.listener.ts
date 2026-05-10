import type { EventBus } from "../../../../shared/application/event-bus";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { LogListenerPort } from "../../domain/ports/log-listener.port";
import type { MinecraftLogPort } from "../../domain/ports/minecraft-log.port";
import type { PatternRegistryPort } from "../../domain/ports/pattern-registry.port";
import { MinecraftLogPatternMatched } from "../../domain/events/minecraft-log-pattern-matched.event";

const CHAT_PREFIX_RE = /]:\s*<(\w+)>\s*(.*)/;

export class MinecraftLogListener implements LogListenerPort {
  private readonly unsubs = new Map<string, () => void>();

  constructor(
    private readonly logPort: MinecraftLogPort,
    private readonly patternRegistry: PatternRegistryPort,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
  ) {}

  startListening(serverId: string): void {
    if (this.unsubs.has(serverId)) return;

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

    const playerName = chatMatch[1]!;
    const message = chatMatch[2]!;

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
}
