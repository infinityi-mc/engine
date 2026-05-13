import type { QueryBus } from "../../../../shared/application/query-bus";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { GetPlayerDataQuery } from "../../../minecraft/application/queries/get-player-data.query";
import { InvalidMinecraftPlayerNameError } from "../../../minecraft/domain/errors/invalid-minecraft-player-name.error";
import { MinecraftPlayerDataTimeoutError } from "../../../minecraft/domain/errors/minecraft-player-data-timeout.error";
import { MinecraftPlayerOfflineError } from "../../../minecraft/domain/errors/minecraft-player-offline.error";
import { MinecraftServerNotFoundError } from "../../../minecraft/domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../../minecraft/domain/errors/minecraft-server-not-running.error";
import type { PlayerDataResult } from "../../../minecraft/domain/types/player-data";
import type { Tool, ToolContext, ToolResult } from "../../domain/types/tool.types";
import { asObject, jsonOk, toolError } from "./tool-helpers";

export class GetPlayerInfoTool implements Tool {
  readonly name = "get_player_info";
  readonly description =
    "Get live in-game NBT entity data for an online Minecraft player. Excludes attributes and recipeBook. Requires a running server and online player.";
  readonly groups = ["minecraft"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      serverId: {
        type: "string",
        description: "The ID of the Minecraft server.",
      },
      playerName: {
        type: "string",
        description: "The exact Minecraft player name to inspect.",
      },
    },
    required: ["serverId", "playerName"],
  };

  constructor(
    private readonly queryBus: QueryBus,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const parsed = validateInput(input, context);
    if (!parsed.ok) return toolError(parsed.error);

    const { serverId, playerName } = parsed.value;
    try {
      const result = await this.queryBus.execute<GetPlayerDataQuery, PlayerDataResult>(
        new GetPlayerDataQuery(serverId, playerName),
      );
      this.logger.info("agent.tool.get_player_info.executed", { serverId, playerName });
      return jsonOk({ ...result, online: true });
    } catch (error) {
      return handleError(error);
    }
  }
}

function validateInput(
  input: unknown,
  context?: ToolContext,
):
  | { ok: true; value: { serverId: string; playerName: string } }
  | { ok: false; error: string } {
  const obj = asObject(input);
  if (!obj) return { ok: false, error: "Input must be an object." };

  const serverId = (typeof obj.serverId === "string" && obj.serverId.length > 0)
    ? obj.serverId
    : context?.serverId;
  if (!serverId || serverId.length === 0) {
    return { ok: false, error: "Missing or invalid required field: serverId (non-empty string)." };
  }

  const playerName = (typeof obj.playerName === "string" && obj.playerName.length > 0)
    ? obj.playerName
    : context?.playerName;
  if (!playerName || playerName.length === 0) {
    return { ok: false, error: "Missing or invalid required field: playerName (non-empty string)." };
  }

  return { ok: true, value: { serverId, playerName } };
}

function handleError(error: unknown): ToolResult {
  if (
    error instanceof InvalidMinecraftPlayerNameError ||
    error instanceof MinecraftPlayerOfflineError ||
    error instanceof MinecraftPlayerDataTimeoutError ||
    error instanceof MinecraftServerNotFoundError ||
    error instanceof MinecraftServerNotRunningError
  ) {
    return toolError(error.message);
  }
  if (error instanceof Error) {
    return toolError(error.message);
  }
  return toolError(String(error));
}
