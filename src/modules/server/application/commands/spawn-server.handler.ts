import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerProcessPort } from "../../domain/ports/server-process.port";
import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { ServerInstance } from "../../domain/types/server-instance";
import type { SpawnServerCommand } from "./spawn-server.command";
import { ServerAlreadyExistsError } from "../../domain/errors/server-already-exists.error";

export class SpawnServerHandler implements CommandHandler<SpawnServerCommand, ServerInstance> {
  constructor(
    private readonly serverProcess: ServerProcessPort,
    private readonly registry: ServerRegistryPort,
  ) {}

  async handle(command: SpawnServerCommand): Promise<ServerInstance> {
    const existing = await this.registry.get(command.input.id);
    if (existing !== undefined) {
      throw new ServerAlreadyExistsError(command.input.id);
    }

    const instance = await this.serverProcess.spawn(command.input);
    await this.registry.register(instance);

    return instance;
  }
}
