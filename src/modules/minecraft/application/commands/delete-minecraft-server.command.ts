import type { Command } from "../../../../shared/application/command-bus";

export const DELETE_MINECRAFT_SERVER_COMMAND = "minecraft.server.delete" as const;

export class DeleteMinecraftServerCommand implements Command<typeof DELETE_MINECRAFT_SERVER_COMMAND> {
  readonly type = DELETE_MINECRAFT_SERVER_COMMAND;

  constructor(readonly serverId: string) {}
}
