export type ServerStatus = 'running' | 'stopped' | 'crashed';

export interface MinecraftServer {
	readonly id: string;
	readonly name: string;
	readonly directory: string;
	readonly javaPath: string;
	readonly jarFile: string;
	readonly jvmArgs: string[];
	readonly serverArgs: string[];
}

export interface ServerInstance {
	readonly id: string;
	readonly pid: number;
	readonly command: string;
	readonly args: string[];
	readonly cwd?: string;
	readonly status: ServerStatus;
	readonly startedAt: string;
	readonly stoppedAt?: string;
}

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

export interface ServerCardData {
	readonly id: string;
	readonly name: string;
	readonly status: ServerStatus;
	readonly worldName: string;
	readonly port: number;
	readonly minecraftVersion: string;
	readonly serverBrand: string;
}
