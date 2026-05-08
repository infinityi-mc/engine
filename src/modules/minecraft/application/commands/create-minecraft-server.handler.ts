import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftServer } from "../../domain/types/minecraft-server";
import type { CreateMinecraftServerCommand } from "./create-minecraft-server.command";
import { MinecraftServerAlreadyExistsError } from "../../domain/errors/minecraft-server-already-exists.error";

export class CreateMinecraftServerHandler implements CommandHandler<CreateMinecraftServerCommand, MinecraftServer> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
  ) {}

  async handle(command: CreateMinecraftServerCommand): Promise<MinecraftServer> {
    const existing = await this.repository.get(command.server.id);
    if (existing !== undefined) {
      throw new MinecraftServerAlreadyExistsError(command.server.id);
    }

    await this.repository.save(command.server);

    return command.server;
  }
}
