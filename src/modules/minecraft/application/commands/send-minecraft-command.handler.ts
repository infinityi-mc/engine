import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../domain/ports/minecraft-stdin.port";
import type { SendMinecraftCommandCommand } from "./send-minecraft-command.command";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../domain/errors/minecraft-server-not-running.error";

export class SendMinecraftCommandHandler implements CommandHandler<SendMinecraftCommandCommand, void> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly stdin: MinecraftStdinPort,
  ) {}

  async handle(command: SendMinecraftCommandCommand): Promise<void> {
    const server = await this.repository.get(command.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(command.serverId);
    }

    const instance = await this.serverRegistry.get(command.serverId);
    if (instance === undefined || instance.status !== "running") {
      throw new MinecraftServerNotRunningError(command.serverId);
    }

    await this.stdin.sendCommand(command.serverId, command.command);
  }
}
