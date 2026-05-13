import type { AudioPlayerService } from "../../../audioplayer/application/audio-player.service";
import type { AudioTrackSortBy, SortOrder } from "../../../audioplayer/domain/types/audio-track";
import type { Tool, ToolContext, ToolResult } from "../../domain/types/tool.types";
import { asObject, jsonOk, toolError } from "./tool-helpers";

export class PlayMusicTool implements Tool {
  readonly name = "play_music";
  readonly description = "Play a downloaded audio track in-game for an online player on an audioPlayer-enabled Minecraft server.";
  readonly groups = ["audioplayer"] as const;
  readonly inputSchema = {
    type: "object",
    properties: {
      serverId: { type: "string" },
      trackId: { type: "string" },
      player: { type: "string" },
      range: { type: "number" },
    },
    required: ["serverId", "trackId", "player"],
  };

  constructor(private readonly service: AudioPlayerService) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");
    const serverId = stringValue(obj.serverId) ?? context?.serverId;
    const player = stringValue(obj.player) ?? context?.playerName;
    const trackId = stringValue(obj.trackId);
    if (!serverId) return toolError("Missing required field: serverId.");
    if (!trackId) return toolError("Missing required field: trackId.");
    if (!player) return toolError("Missing required field: player.");

    return runTool(() => this.service.playMusic({
      serverId,
      trackId,
      player,
      ...(typeof obj.range === "number" && obj.range > 0 ? { range: obj.range } : {}),
    }));
  }
}

export class StopMusicTool implements Tool {
  readonly name = "stop_music";
  readonly description = "Stop a playing downloaded audio track on an audioPlayer-enabled Minecraft server.";
  readonly groups = ["audioplayer"] as const;
  readonly inputSchema = {
    type: "object",
    properties: {
      serverId: { type: "string" },
      trackId: { type: "string" },
    },
    required: ["serverId", "trackId"],
  };

  constructor(private readonly service: AudioPlayerService) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");
    const serverId = stringValue(obj.serverId) ?? context?.serverId;
    const trackId = stringValue(obj.trackId);
    if (!serverId) return toolError("Missing required field: serverId.");
    if (!trackId) return toolError("Missing required field: trackId.");

    return runTool(() => this.service.stopMusic(serverId, trackId));
  }
}

export class SearchMusicTool implements Tool {
  readonly name = "search_music";
  readonly description = "Search YouTube for music that can be downloaded by the audioplayer module.";
  readonly groups = ["audioplayer"] as const;
  readonly inputSchema = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };

  constructor(private readonly service: AudioPlayerService) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");
    const query = stringValue(obj.query);
    if (!query) return toolError("Missing required field: query.");

    return runTool(() => this.service.searchMusic(query));
  }
}

export class DownloadMusicTool implements Tool {
  readonly name = "download_music";
  readonly description = "Download a YouTube audio track for a server world. The server generates and returns the local track ID.";
  readonly groups = ["audioplayer"] as const;
  readonly inputSchema = {
    type: "object",
    properties: {
      serverId: { type: "string" },
      url: { type: "string" },
      requestedPlayer: { type: "string" },
    },
    required: ["serverId", "url"],
  };

  constructor(private readonly service: AudioPlayerService) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");
    const serverId = stringValue(obj.serverId) ?? context?.serverId;
    const url = stringValue(obj.url);
    if (!serverId) return toolError("Missing required field: serverId.");
    if (!url) return toolError("Missing required field: url.");

    const requestedPlayer = stringValue(obj.requestedPlayer) ?? context?.playerName;
    return runTool(() => this.service.downloadMusic({
      serverId,
      url,
      ...(requestedPlayer !== undefined ? { requestedPlayer } : {}),
    }));
  }
}

export class DeleteMusicTool implements Tool {
  readonly name = "delete_music";
  readonly description = "Delete a downloaded audio track from disk and the audioplayer store when it is not playing.";
  readonly groups = ["audioplayer"] as const;
  readonly inputSchema = {
    type: "object",
    properties: {
      serverId: { type: "string" },
      trackId: { type: "string" },
    },
    required: ["serverId", "trackId"],
  };

  constructor(private readonly service: AudioPlayerService) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");
    const serverId = stringValue(obj.serverId) ?? context?.serverId;
    const trackId = stringValue(obj.trackId);
    if (!serverId) return toolError("Missing required field: serverId.");
    if (!trackId) return toolError("Missing required field: trackId.");

    return runTool(async () => {
      await this.service.deleteMusic(serverId, trackId);
      return { ok: true };
    });
  }
}

export class ListMusicTool implements Tool {
  readonly name = "list_music";
  readonly description = "List downloaded audio tracks for a server, with optional title/artist query, limit, and sorting.";
  readonly groups = ["audioplayer"] as const;
  readonly inputSchema = {
    type: "object",
    properties: {
      serverId: { type: "string" },
      query: { type: "string" },
      limit: { type: "number" },
      sortBy: { type: "string", enum: ["date", "duration", "size"] },
      sortOrder: { type: "string", enum: ["asc", "desc"] },
    },
    required: ["serverId"],
  };

  constructor(private readonly service: AudioPlayerService) {}

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");
    const serverId = stringValue(obj.serverId) ?? context?.serverId;
    if (!serverId) return toolError("Missing required field: serverId.");

    const query = stringValue(obj.query);
    return runTool(() => this.service.listMusic({
      serverId,
      ...(query !== undefined ? { query } : {}),
      ...(typeof obj.limit === "number" && obj.limit > 0 ? { limit: obj.limit } : {}),
      ...(isSortBy(obj.sortBy) ? { sortBy: obj.sortBy } : {}),
      ...(isSortOrder(obj.sortOrder) ? { sortOrder: obj.sortOrder } : {}),
    }));
  }
}

async function runTool(action: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return jsonOk(await action());
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSortBy(value: unknown): value is AudioTrackSortBy {
  return value === "date" || value === "duration" || value === "size";
}

function isSortOrder(value: unknown): value is SortOrder {
  return value === "asc" || value === "desc";
}
