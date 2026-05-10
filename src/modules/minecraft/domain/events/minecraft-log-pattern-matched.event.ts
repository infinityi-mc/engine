import type { DomainEvent } from "../../../../shared/domain/domain-event";

export const MINECRAFT_LOG_PATTERN_MATCHED = "minecraft.log.pattern_matched" as const;

export class MinecraftLogPatternMatched
  implements DomainEvent<typeof MINECRAFT_LOG_PATTERN_MATCHED>
{
  readonly eventId: string;
  readonly eventName = MINECRAFT_LOG_PATTERN_MATCHED;
  readonly occurredAt: Date;

  constructor(
    readonly serverId: string,
    readonly playerName: string,
    readonly message: string,
    readonly pattern: string,
    readonly action: string,
    readonly payload: Record<string, unknown> | undefined,
  ) {
    this.eventId = crypto.randomUUID();
    this.occurredAt = new Date();
  }
}
