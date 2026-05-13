import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { LogListenerPort } from "../../domain/ports/log-listener.port";
import type { MinecraftServer } from "../../domain/types/minecraft-server";
import type { UpdateMinecraftServerCommand, MinecraftServerPatch } from "./update-minecraft-server.command";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerRunningError } from "../../domain/errors/minecraft-server-running.error";

const SPAWN_AFFECTING_KEYS: ReadonlyArray<keyof MinecraftServerPatch> = [
  "directory",
  "javaPath",
  "jarFile",
  "jvmArgs",
  "serverArgs",
] as const;

function patchHasSpawnFields(patch: MinecraftServerPatch): boolean {
  return SPAWN_AFFECTING_KEYS.some((key) => patch[key] !== undefined);
}

export class UpdateMinecraftServerHandler implements CommandHandler<UpdateMinecraftServerCommand, MinecraftServer> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly logListener: LogListenerPort,
  ) {}

  async handle(command: UpdateMinecraftServerCommand): Promise<MinecraftServer> {
    const existing = await this.repository.get(command.serverId);
    if (existing === undefined) {
      throw new MinecraftServerNotFoundError(command.serverId);
    }

    const instance = await this.serverRegistry.get(command.serverId);
    const isRunning = instance !== undefined && instance.status === "running";

    if (isRunning && patchHasSpawnFields(command.patch)) {
      throw new MinecraftServerRunningError(command.serverId);
    }

    const updated = applyPatch(existing, command.patch);
    await this.repository.save(updated);

    if (isRunning && command.patch.players !== undefined) {
      await this.logListener.refreshConfig(command.serverId);
    }

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
    ...(patch.features !== undefined ? { features: patch.features } : server.features !== undefined ? { features: server.features } : {}),
  };
}
