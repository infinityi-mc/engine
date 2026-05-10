import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftLogPort } from "../../domain/ports/minecraft-log.port";
import type { StreamMinecraftLogsQuery } from "./stream-minecraft-logs.query";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../domain/errors/minecraft-server-not-running.error";

export class StreamMinecraftLogsHandler implements QueryHandler<StreamMinecraftLogsQuery, ReadableStream<Uint8Array>> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly logPort: MinecraftLogPort,
  ) {}

  async handle(query: StreamMinecraftLogsQuery): Promise<ReadableStream<Uint8Array>> {
    const server = await this.repository.get(query.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(query.serverId);
    }

    const instance = await this.serverRegistry.get(query.serverId);
    if (instance === undefined || instance.status !== "running") {
      throw new MinecraftServerNotRunningError(query.serverId);
    }

    return this.logPort.createSSEStream(query.serverId);
  }
}
