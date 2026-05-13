import type { PlayerDataResult } from "../types/player-data";

export interface GetPlayerDataPort {
  getPlayerData(serverId: string, playerName: string): Promise<PlayerDataResult>;
}
