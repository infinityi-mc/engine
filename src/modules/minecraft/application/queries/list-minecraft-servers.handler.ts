import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftServer } from "../../domain/types/minecraft-server";
import type { ListMinecraftServersQuery } from "./list-minecraft-servers.query";

export class ListMinecraftServersHandler implements QueryHandler<ListMinecraftServersQuery, MinecraftServer[]> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
  ) {}

  handle(_query: ListMinecraftServersQuery): Promise<MinecraftServer[]> {
    return this.repository.list();
  }
}
