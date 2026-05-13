import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { ServerRegistryPort } from "../../../server/domain/ports/server-registry.port";
import type { GetPlayerDataPort } from "../../domain/ports/get-player-data.port";
import type { MinecraftLogPort } from "../../domain/ports/minecraft-log.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../domain/ports/minecraft-stdin.port";
import type { PlayerDataResult } from "../../domain/types/player-data";
import { InvalidMinecraftPlayerNameError } from "../../domain/errors/invalid-minecraft-player-name.error";
import { MinecraftPlayerDataTimeoutError } from "../../domain/errors/minecraft-player-data-timeout.error";
import { MinecraftPlayerOfflineError } from "../../domain/errors/minecraft-player-offline.error";
import { MinecraftServerNotFoundError } from "../../domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../domain/errors/minecraft-server-not-running.error";
import { parsePlayerDataFeedbackLine } from "./snbt-player-data-parser";

const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
const PLAYER_DATA_TIMEOUT_MS = 5_000;

export class MinecraftCommandPlayerDataAdapter implements GetPlayerDataPort {
  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly serverRegistry: ServerRegistryPort,
    private readonly stdin: MinecraftStdinPort,
    private readonly logPort: MinecraftLogPort,
    private readonly logger: LoggerPort,
    private readonly timeoutMs = PLAYER_DATA_TIMEOUT_MS,
  ) {}

  async getPlayerData(serverId: string, playerName: string): Promise<PlayerDataResult> {
    if (!PLAYER_NAME_PATTERN.test(playerName)) {
      throw new InvalidMinecraftPlayerNameError(playerName);
    }

    const server = await this.repository.get(serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(serverId);
    }

    const instance = await this.serverRegistry.get(serverId);
    if (instance === undefined || instance.status !== "running") {
      throw new MinecraftServerNotRunningError(serverId);
    }

    const data = await this.executeWithFeedback(serverId, playerName);
    this.logger.info("minecraft.player_data.get", { serverId, playerName });
    return { serverId, playerName, data };
  }

  private executeWithFeedback(serverId: string, playerName: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(() => reject(new MinecraftPlayerDataTimeoutError(serverId, playerName, this.timeoutMs)));
      }, this.timeoutMs);

      const unsubscribe = this.logPort.onLogLine(serverId, (line) => {
        try {
          const feedback = parsePlayerDataFeedbackLine(line, playerName);
          if (feedback.kind === "unrelated") return;
          if (feedback.kind === "offline") {
            finish(() => reject(new MinecraftPlayerOfflineError(serverId, playerName)));
            return;
          }
          finish(() => resolve(feedback.data));
        } catch (error) {
          finish(() => reject(error));
        }
      });

      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        complete();
      };

      this.stdin.sendCommand(serverId, `data get entity ${playerName}`).catch((error: unknown) => {
        finish(() => reject(error));
      });
    });
  }
}
