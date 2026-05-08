import type { Command } from "../../../../shared/application/command-bus";

export const SEND_MINECRAFT_COMMAND_COMMAND = "minecraft.server.send-command" as const;

export class SendMinecraftCommandCommand implements Command<typeof SEND_MINECRAFT_COMMAND_COMMAND> {
  readonly type = SEND_MINECRAFT_COMMAND_COMMAND;

  constructor(
    readonly serverId: string,
    readonly command: string,
  ) {}
}
