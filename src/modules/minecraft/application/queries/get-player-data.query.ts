import type { Query } from "../../../../shared/application/query-bus";

export const GET_PLAYER_DATA_QUERY = "minecraft.player.get-data" as const;

export class GetPlayerDataQuery implements Query<typeof GET_PLAYER_DATA_QUERY> {
  readonly type = GET_PLAYER_DATA_QUERY;

  constructor(readonly serverId: string, readonly playerName: string) {}
}
