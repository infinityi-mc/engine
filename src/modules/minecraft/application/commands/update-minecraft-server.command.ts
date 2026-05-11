import type { Command } from "../../../../shared/application/command-bus";
import type { PlayerConfig, AgentAccess } from "../../domain/types/minecraft-server";

export const UPDATE_MINECRAFT_SERVER_COMMAND = "minecraft.server.update" as const;

export interface MinecraftServerPatch {
  readonly name?: string;
  readonly directory?: string;
  readonly javaPath?: string;
  readonly jarFile?: string;
  readonly jvmArgs?: string[];
  readonly serverArgs?: string[];
  readonly players?: PlayerConfig;
  readonly agents?: AgentAccess[];
}

export class UpdateMinecraftServerCommand implements Command<typeof UPDATE_MINECRAFT_SERVER_COMMAND> {
  readonly type = UPDATE_MINECRAFT_SERVER_COMMAND;

  constructor(
    readonly serverId: string,
    readonly patch: MinecraftServerPatch,
  ) {}
}
