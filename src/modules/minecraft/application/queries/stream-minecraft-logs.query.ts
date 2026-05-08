import type { Query } from "../../../../shared/application/query-bus";

export const STREAM_MINECRAFT_LOGS_QUERY = "minecraft.server.stream-logs" as const;

export class StreamMinecraftLogsQuery implements Query<typeof STREAM_MINECRAFT_LOGS_QUERY> {
  readonly type = STREAM_MINECRAFT_LOGS_QUERY;

  constructor(readonly serverId: string) {}
}
