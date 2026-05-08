import type { Command } from "../../../../shared/application/command-bus";

export const START_MINECRAFT_SERVER_COMMAND = "minecraft.server.start" as const;

export class StartMinecraftServerCommand implements Command<typeof START_MINECRAFT_SERVER_COMMAND> {
  readonly type = START_MINECRAFT_SERVER_COMMAND;

  constructor(readonly serverId: string) {}
}
