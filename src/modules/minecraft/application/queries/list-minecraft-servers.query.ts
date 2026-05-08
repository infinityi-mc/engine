import type { Query } from "../../../../shared/application/query-bus";

export const LIST_MINECRAFT_SERVERS_QUERY = "minecraft.server.list" as const;

export class ListMinecraftServersQuery implements Query<typeof LIST_MINECRAFT_SERVERS_QUERY> {
  readonly type = LIST_MINECRAFT_SERVERS_QUERY;
}
