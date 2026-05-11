import type { QueryBus } from "../../../../shared/application/query-bus";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Tool, ToolResult } from "../../domain/types/tool.types";
import { GetServerMetadataQuery } from "../../../minecraft/application/queries/get-server-metadata.query";
import type { ServerMetadata } from "../../../minecraft/domain/types/server-metadata";
import { MinecraftServerNotFoundError } from "../../../minecraft/domain/errors/minecraft-server-not-found.error";
import { ServerPropertiesNotFoundError } from "../../../minecraft/domain/errors/server-properties-not-found.error";
import { toolError, jsonOk, asObject } from "./tool-helpers";

export class MinecraftMetadataTool implements Tool {
  readonly name = "minecraft_metadata";
  readonly description =
    "Get metadata for a Minecraft server: server.properties values (levelName, maxPlayers, serverPort) and world info (isRunning, worldName, minecraftVersion, serverBrands).";
  readonly groups = ["minecraft"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      serverId: {
        type: "string",
        description: "The ID of the Minecraft server.",
      },
    },
    required: ["serverId"],
  };

  constructor(
    private readonly queryBus: QueryBus,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const serverId = obj.serverId;
    if (typeof serverId !== "string" || serverId.length === 0) {
      return toolError(
        "Missing or invalid required field: serverId (non-empty string).",
      );
    }

    try {
      const metadata = await this.queryBus.execute<
        GetServerMetadataQuery,
        ServerMetadata
      >(new GetServerMetadataQuery(serverId));
      this.logger.info("agent.tool.minecraft_metadata.executed", { serverId });
      return jsonOk(metadata);
    } catch (error) {
      if (error instanceof MinecraftServerNotFoundError) {
        return toolError(error.message);
      }
      if (error instanceof ServerPropertiesNotFoundError) {
        return toolError(error.message);
      }
      if (error instanceof Error) {
        return toolError(error.message);
      }
      return toolError(String(error));
    }
  }
}
