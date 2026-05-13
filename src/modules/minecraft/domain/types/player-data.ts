export type PlayerData = Record<string, unknown>;

export interface PlayerDataResult {
  readonly serverId: string;
  readonly playerName: string;
  readonly data: PlayerData;
}
