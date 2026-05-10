import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerProcessPort } from "../../../server/domain/ports/server-process.port";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { ServerInstance } from "../../../server/domain/types/server-instance";
import type { StartMinecraftServerCommand } from "./start-minecraft-server.command";
import type { LogListenerPort } from "../../domain/ports/log-listener.port";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { ServerAlreadyExistsError } from "../../../server/domain/errors/server-already-exists.error";

export class StartMinecraftServerHandler implements CommandHandler<StartMinecraftServerCommand, ServerInstance> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverProcess: ServerProcessPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly logListener: LogListenerPort,
  ) {}

  async handle(command: StartMinecraftServerCommand): Promise<ServerInstance> {
    const server = await this.repository.get(command.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(command.serverId);
    }

    const existing = await this.serverRegistry.get(command.serverId);
    if (existing !== undefined && existing.status === "running") {
      throw new ServerAlreadyExistsError(command.serverId);
    }

    const instance = await this.serverProcess.spawn({
      id: server.id,
      command: server.javaPath,
      args: [...server.jvmArgs, "-jar", server.jarFile, ...server.serverArgs],
      cwd: server.directory,
    });

    await this.serverRegistry.register(instance);

    this.logListener.startListening(server.id);

    return instance;
  }
}
