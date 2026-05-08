import type { QueryHandler } from "../../../../shared/application/query-bus";
import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { ServerProcessPort } from "../../domain/ports/server-process.port";
import type { ServerInstance } from "../../domain/types/server-instance";
import type { GetServerStatusQuery } from "./get-server-status.query";
import { ServerNotFoundError } from "../../domain/errors/server-not-found.error";

export class GetServerStatusHandler implements QueryHandler<GetServerStatusQuery, ServerInstance> {
  constructor(
    private readonly registry: ServerRegistryPort,
    private readonly serverProcess: ServerProcessPort,
  ) {}

  async handle(query: GetServerStatusQuery): Promise<ServerInstance> {
    const instance = await this.registry.get(query.instanceId);
    if (instance === undefined) {
      throw new ServerNotFoundError(query.instanceId);
    }

    const alive = await this.serverProcess.isAlive(query.instanceId);
    if (!alive && instance.status === "running") {
      await this.registry.updateStatus(query.instanceId, "crashed", new Date());
      const updated = await this.registry.get(query.instanceId);
      if (updated === undefined) {
        throw new ServerNotFoundError(query.instanceId);
      }
      return updated;
    }

    return instance;
  }
}
