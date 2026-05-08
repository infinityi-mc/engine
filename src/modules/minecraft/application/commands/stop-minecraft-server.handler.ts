import type { CommandHandler } from "../../../../shared/application/command-bus";
import type { ServerProcessPort } from "../../../server/domain/ports/server-process.port";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../domain/ports/minecraft-stdin.port";
import type { StopMinecraftServerCommand } from "./stop-minecraft-server.command";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../domain/errors/minecraft-server-not-running.error";
import { ServerNotFoundError } from "../../../server/domain/errors/server-not-found.error";
import { GRACEFUL_STOP_TIMEOUT_MS } from "../../domain/types/minecraft-server";

export class StopMinecraftServerHandler implements CommandHandler<StopMinecraftServerCommand, void> {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverProcess: ServerProcessPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly stdin: MinecraftStdinPort,
    private readonly waitForExit: (instanceId: string, timeoutMs: number) => Promise<boolean>,
  ) {}

  async handle(command: StopMinecraftServerCommand): Promise<void> {
    const server = await this.repository.get(command.serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(command.serverId);
    }

    const existing = await this.serverRegistry.get(command.serverId);
    if (existing === undefined) {
      throw new ServerNotFoundError(command.serverId);
    }

    // Send /stop command for graceful shutdown (saves world data)
    try {
      await this.stdin.sendCommand(command.serverId, "stop");
    } catch (error) {
      // Only swallow expected errors — stdin may be closed if the process is already exiting
      if (!(error instanceof MinecraftServerNotRunningError)) {
        throw error;
      }
    }

    // Wait for the process to exit on its own
    const exitedGracefully = await this.waitForExit(command.serverId, GRACEFUL_STOP_TIMEOUT_MS);

    if (!exitedGracefully) {
      // Process didn't exit in time — force-kill
      await this.serverProcess.kill(command.serverId);
    }

    await this.serverRegistry.unregister(command.serverId);
  }
}
