import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { GetPlayerDataPort } from "../../domain/ports/get-player-data.port";
import type { PlayerDataResult } from "../../domain/types/player-data";
import type { GetPlayerDataQuery } from "./get-player-data.query";

export class GetPlayerDataHandler implements QueryHandler<GetPlayerDataQuery, PlayerDataResult> {
  constructor(private readonly playerData: GetPlayerDataPort) {}

  async handle(query: GetPlayerDataQuery): Promise<PlayerDataResult> {
    return this.playerData.getPlayerData(query.serverId, query.playerName);
  }
}
