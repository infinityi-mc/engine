import type { Command } from "../../../../shared/application/command-bus";
import type { MinecraftServer } from "../../domain/types/minecraft-server";

export const CREATE_MINECRAFT_SERVER_COMMAND = "minecraft.server.create" as const;

export class CreateMinecraftServerCommand implements Command<typeof CREATE_MINECRAFT_SERVER_COMMAND> {
  readonly type = CREATE_MINECRAFT_SERVER_COMMAND;

  constructor(readonly server: MinecraftServer) {}
}
