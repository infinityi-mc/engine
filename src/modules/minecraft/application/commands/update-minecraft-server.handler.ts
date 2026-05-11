import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftServer } from "../../domain/types/minecraft-server";
import type { UpdateMinecraftServerCommand, MinecraftServerPatch } from "./update-minecraft-server.command";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerRunningError } from "../../domain/errors/minecraft-server-running.error";

export class UpdateMinecraftServerHandler implements CommandHandler<UpdateMinecraftServerCommand, MinecraftServer> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverRegistry: ServerRegistryPort,
  ) {}

  async handle(command: UpdateMinecraftServerCommand): Promise<MinecraftServer> {
    const existing = await this.repository.get(command.serverId);
    if (existing === undefined) {
      throw new MinecraftServerNotFoundError(command.serverId);
    }

    const instance = await this.serverRegistry.get(command.serverId);
    if (instance !== undefined && instance.status === "running") {
      throw new MinecraftServerRunningError(command.serverId);
    }

    const updated = applyPatch(existing, command.patch);
    await this.repository.save(updated);

    return updated;
  }
}

function applyPatch(server: MinecraftServer, patch: MinecraftServerPatch): MinecraftServer {
  return {
    id: server.id,
    name: patch.name ?? server.name,
    directory: patch.directory ?? server.directory,
    javaPath: patch.javaPath ?? server.javaPath,
    jarFile: patch.jarFile ?? server.jarFile,
    jvmArgs: patch.jvmArgs ?? server.jvmArgs,
    serverArgs: patch.serverArgs ?? server.serverArgs,
    ...(patch.players !== undefined ? { players: patch.players } : server.players !== undefined ? { players: server.players } : {}),
    ...(patch.agents !== undefined ? { agents: patch.agents } : server.agents !== undefined ? { agents: server.agents } : {}),
  };
}
