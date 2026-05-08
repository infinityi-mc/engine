import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftServerDetails } from "./get-minecraft-server.query";
import type { GetMinecraftServerQuery } from "./get-minecraft-server.query";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";

export class GetMinecraftServerHandler implements QueryHandler<GetMinecraftServerQuery, MinecraftServerDetails> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverRegistry: ServerRegistryPort,
  ) {}

  async handle(query: GetMinecraftServerQuery): Promise<MinecraftServerDetails> {
    const server = await this.repository.get(query.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(query.serverId);
    }

    const instance = await this.serverRegistry.get(query.serverId);

    return {
      id: server.id,
      name: server.name,
      directory: server.directory,
      javaPath: server.javaPath,
      jarFile: server.jarFile,
      jvmArgs: server.jvmArgs,
      serverArgs: server.serverArgs,
      status: instance?.status ?? "stopped",
      pid: instance?.pid,
      startedAt: instance?.startedAt,
      stoppedAt: instance?.stoppedAt,
    };
  }
}
