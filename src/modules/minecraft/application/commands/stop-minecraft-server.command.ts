import type { Command } from "../../../../shared/application/command-bus";

export const STOP_MINECRAFT_SERVER_COMMAND = "minecraft.server.stop" as const;

export class StopMinecraftServerCommand implements Command<typeof STOP_MINECRAFT_SERVER_COMMAND> {
  readonly type = STOP_MINECRAFT_SERVER_COMMAND;

  constructor(readonly serverId: string) {}
}
