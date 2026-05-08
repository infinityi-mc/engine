import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerProcessPort } from "../../domain/ports/server-process.port";
import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { KillServerCommand } from "./kill-server.command";
import { ServerNotFoundError } from "../../domain/errors/server-not-found.error";

export class KillServerHandler implements CommandHandler<KillServerCommand, void> {
  constructor(
    private readonly serverProcess: ServerProcessPort,
    private readonly registry: ServerRegistryPort,
  ) {}

  async handle(command: KillServerCommand): Promise<void> {
    const existing = await this.registry.get(command.instanceId);
    if (existing === undefined) {
      throw new ServerNotFoundError(command.instanceId);
    }

    await this.serverProcess.kill(command.instanceId);
    await this.registry.unregister(command.instanceId);
  }
}
