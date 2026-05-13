import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import { parseJson, requiredString } from "../../../../shared/http/route-helpers";
import type { Router } from "../../../../shared/http/router";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { InvalidMinecraftPlayerNameError } from "../../../minecraft/domain/errors/invalid-minecraft-player-name.error";
import { MinecraftPlayerOfflineError } from "../../../minecraft/domain/errors/minecraft-player-offline.error";
import { MinecraftServerNotFoundError } from "../../../minecraft/domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../../minecraft/domain/errors/minecraft-server-not-running.error";
import {
  AudioDownloadTooLargeError,
  AudioPlayerFeatureDisabledError,
  AudioPlayerRequestLimitError,
  AudioTrackAlreadyPlayingError,
  AudioTrackNotFoundError,
  AudioTrackWorldMismatchError,
} from "../../domain/errors/audio-player.errors";
import type { AudioTrack, AudioTrackSortBy, SortOrder } from "../../domain/types/audio-track";
import type { AudioPlayerService } from "../../application/audio-player.service";
import { SCOPES } from "./scopes";

export function registerAudioPlayerRoutes(
  router: Router,
  service: AudioPlayerService,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  router.get("/audioplayer/search", guard.protect(async (request) => {
    const query = new URL(request.url).searchParams.get("query");
    if (!query) return jsonResponse({ error: "query is required" }, { status: 400 });

    return handleErrors(async () => jsonResponse({ results: await service.searchMusic(query) }), logger);
  }, SCOPES.AUDIOPLAYER_READ));

  router.post("/audioplayer/tracks", guard.protect(async (request) => {
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const serverId = requiredString(parsed.body, "serverId");
    if (!serverId.ok) return serverId.response;
    const url = requiredString(parsed.body, "url");
    if (!url.ok) return url.response;

    return handleErrors(async () => {
      const track = await service.downloadMusic({
        serverId: serverId.value,
        url: url.value,
        ...(typeof parsed.body.requestedPlayer === "string" ? { requestedPlayer: parsed.body.requestedPlayer } : {}),
      });
      return jsonResponse(serializeTrack(track), { status: 201 });
    }, logger);
  }, SCOPES.AUDIOPLAYER_WRITE));

  router.get("/audioplayer/servers/:serverId/tracks", guard.protect(async (request, params) => {
    const searchParams = new URL(request.url).searchParams;
    const limit = Number(searchParams.get("limit") ?? 10);
    return handleErrors(async () => {
      const query = searchParams.get("query");
      const sortBy = parseSortBy(searchParams.get("sortBy"));
      const sortOrder = parseSortOrder(searchParams.get("sortOrder"));
      const tracks = await service.listMusic({
        serverId: params.serverId!,
        ...(query ? { query } : {}),
        limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
        ...(sortBy !== undefined ? { sortBy } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      });
      return jsonResponse({ tracks: tracks.map(serializeTrack) });
    }, logger);
  }, SCOPES.AUDIOPLAYER_READ));

  router.post("/audioplayer/servers/:serverId/tracks/:trackId/play", guard.protect(async (request, params) => {
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const player = requiredString(parsed.body, "player");
    if (!player.ok) return player.response;
    const range = typeof parsed.body.range === "number" && parsed.body.range > 0 ? parsed.body.range : undefined;

    return handleErrors(async () => {
      const track = await service.playMusic({
        serverId: params.serverId!,
        trackId: params.trackId!,
        player: player.value,
        ...(range !== undefined ? { range } : {}),
      });
      return jsonResponse(serializeTrack(track));
    }, logger);
  }, SCOPES.AUDIOPLAYER_WRITE));

  router.post("/audioplayer/servers/:serverId/tracks/:trackId/stop", guard.protect(async (_request, params) => {
    return handleErrors(async () => {
      const track = await service.stopMusic(params.serverId!, params.trackId!);
      return jsonResponse(serializeTrack(track));
    }, logger);
  }, SCOPES.AUDIOPLAYER_WRITE));

  router.delete("/audioplayer/servers/:serverId/tracks/:trackId", guard.protect(async (_request, params) => {
    return handleErrors(async () => {
      await service.deleteMusic(params.serverId!, params.trackId!);
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.AUDIOPLAYER_WRITE));
}

function serializeTrack(track: AudioTrack): Record<string, unknown> {
  return {
    id: track.id,
    serverId: track.serverId,
    url: track.url,
    title: track.title,
    duration: track.duration,
    tags: track.tags,
    artist: track.artist,
    worldName: track.worldName,
    path: track.path,
    isPlaying: track.isPlaying,
    ...(track.coverImg !== undefined ? { coverImg: track.coverImg } : {}),
    dateAdded: track.dateAdded,
    size: track.size,
    ...(track.requestedPlayer !== undefined ? { requestedPlayer: track.requestedPlayer } : {}),
  };
}

function parseSortBy(value: string | null): AudioTrackSortBy | undefined {
  return value === "date" || value === "duration" || value === "size" ? value : undefined;
}

function parseSortOrder(value: string | null): SortOrder | undefined {
  return value === "asc" || value === "desc" ? value : undefined;
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof MinecraftServerNotFoundError || error instanceof AudioTrackNotFoundError) {
      return jsonResponse({ error: error.name, message: error.message }, { status: 404 });
    }
    if (error instanceof AudioPlayerFeatureDisabledError) {
      return jsonResponse({ error: error.name, serverId: error.serverId, message: error.message }, { status: 403 });
    }
    if (error instanceof InvalidMinecraftPlayerNameError) {
      return jsonResponse({ error: error.name, playerName: error.playerName, message: error.message }, { status: 400 });
    }
    if (error instanceof MinecraftServerNotRunningError || error instanceof MinecraftPlayerOfflineError) {
      return jsonResponse({ error: error.name, message: error.message }, { status: 409 });
    }
    if (error instanceof AudioPlayerRequestLimitError) {
      return jsonResponse({ error: error.name, playerName: error.playerName, message: error.message }, { status: 429 });
    }
    if (
      error instanceof AudioTrackWorldMismatchError ||
      error instanceof AudioTrackAlreadyPlayingError ||
      error instanceof AudioDownloadTooLargeError
    ) {
      return jsonResponse({ error: error.name, message: error.message }, { status: 400 });
    }

    logger.error("audioplayer.http.unhandled_error", {
      module: "audioplayer",
      operation: "http.handle",
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "InternalServerError" }, { status: 500 });
  }
}
