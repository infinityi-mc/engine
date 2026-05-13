/** Default server arguments for a vanilla Minecraft server (disables the interactive console GUI). */
export const DEFAULT_SERVER_ARGS: readonly string[] = ["--nogui"];

/** Grace period (ms) to wait for a Minecraft server to exit after sending /stop before force-killing. */
export const GRACEFUL_STOP_TIMEOUT_MS = 30_000;

export interface PlayerTeams {
  readonly prefix?: string[];
  readonly suffix?: string[];
}

export interface PlayerConfig {
  readonly teams?: PlayerTeams;
}

export interface AgentAccess {
  readonly id: string;
  readonly players?: string[];
  readonly commands?: readonly string[];
}

export interface MinecraftServerFeatures {
  readonly audioPlayer?: {
    readonly enabled: boolean;
  };
}

export interface MinecraftServer {
  readonly id: string;
  readonly name: string;
  readonly directory: string;
  readonly javaPath: string;
  readonly jarFile: string;
  readonly jvmArgs: string[];
  readonly serverArgs: string[];
  readonly players?: PlayerConfig;
  readonly agents?: AgentAccess[];
  readonly features?: MinecraftServerFeatures;
}
