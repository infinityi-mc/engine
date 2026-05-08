import type { CommandBus } from "../../../../shared/application/command-bus";
import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { DeleteMinecraftServerCommand } from "./delete-minecraft-server.command";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { StopMinecraftServerCommand } from "./stop-minecraft-server.command";
import { ServerNotFoundError } from "../../../server/domain/errors/server-not-found.error";

export class DeleteMinecraftServerHandler implements CommandHandler<DeleteMinecraftServerCommand, void> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly commandBus: CommandBus,
  ) {}

  async handle(command: DeleteMinecraftServerCommand): Promise<void> {
    const server = await this.repository.get(command.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(command.serverId);
    }

    // Gracefully stop the server if it's running (sends /stop, waits, then force-kills)
    try {
      await this.commandBus.execute<StopMinecraftServerCommand, void>(
        new StopMinecraftServerCommand(command.serverId),
      );
    } catch (error) {
      // Server may not be running — that's fine for delete.
      // Stop throws ServerNotFoundError (not in registry) or
      // MinecraftServerNotFoundError (not in repo, e.g. race with another delete).
      if (!(error instanceof ServerNotFoundError) && !(error instanceof MinecraftServerNotFoundError)) {
        throw error;
      }
    }

    await this.repository.remove(command.serverId);
  }
}
