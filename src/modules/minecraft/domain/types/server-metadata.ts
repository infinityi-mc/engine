export interface LevelInfo {
  readonly isRunning: boolean;
  readonly worldName: string;
  readonly minecraftVersion: string;
  readonly serverBrands: readonly string[];
}

export interface ServerMetadata {
  readonly levelName: string;
  readonly maxPlayers: number;
  readonly serverPort: number;
  readonly levelInfo: LevelInfo;
}
