import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { ServerMetadataPort } from "../../domain/ports/server-metadata.port";
import type { ServerMetadata } from "../../domain/types/server-metadata";
import type { GetServerMetadataQuery } from "./get-server-metadata.query";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";

export class GetServerMetadataHandler implements QueryHandler<GetServerMetadataQuery, ServerMetadata> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly metadata: ServerMetadataPort,
  ) {}

  async handle(query: GetServerMetadataQuery): Promise<ServerMetadata> {
    const server = await this.repository.get(query.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(query.serverId);
    }

    return this.metadata.resolve(server.directory);
  }
}
