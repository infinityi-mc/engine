import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { ServerInstance } from "../../domain/types/server-instance";
import type { ListServersQuery } from "./list-servers.query";

export class ListServersHandler implements QueryHandler<ListServersQuery, ServerInstance[]> {
  constructor(private readonly registry: ServerRegistryPort) {}

  handle(_query: ListServersQuery): Promise<ServerInstance[]> {
    return this.registry.list();
  }
}
