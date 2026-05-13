import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ConfigPort } from "../../../shared/config/config.port";
import type { LoggerPort } from "../../../shared/observability/logger.port";
import type { MinecraftServerRepositoryPort } from "../../minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../minecraft/domain/ports/minecraft-stdin.port";
import type { GetPlayerDataPort } from "../../minecraft/domain/ports/get-player-data.port";
import type { ServerMetadataPort } from "../../minecraft/domain/ports/server-metadata.port";
import { InvalidMinecraftPlayerNameError } from "../../minecraft/domain/errors/invalid-minecraft-player-name.error";
import { MinecraftServerNotFoundError } from "../../minecraft/domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../minecraft/domain/errors/minecraft-server-not-running.error";
import type { ServerRegistryPort } from "../../server/domain/ports/server-registry.port";
import type { YoutubeService } from "../../youtube/application/youtube.service";
import type { YoutubeSearchVideo, YoutubeVideoMetadata } from "../../youtube/domain/types/youtube.types";
import {
  AudioDownloadTooLargeError,
  AudioPlayerRequestLimitError,
  AudioPlayerFeatureDisabledError,
  AudioTrackAlreadyPlayingError,
  AudioTrackNotFoundError,
  AudioTrackLevelMismatchError,
} from "../domain/errors/audio-player.errors";
import type { AudioTrackRepositoryPort } from "../domain/ports/audio-track-repository.port";
import type { AudioTrack, ListAudioTracksInput } from "../domain/types/audio-track";

export interface AudioPlayerDependencies {
  readonly tracks: AudioTrackRepositoryPort;
  readonly minecraftRepository: MinecraftServerRepositoryPort;
  readonly serverRegistry: ServerRegistryPort;
  readonly stdin: MinecraftStdinPort;
  readonly metadata: ServerMetadataPort;
  readonly playerData: GetPlayerDataPort;
  readonly youtube: YoutubeService;
  readonly config: ConfigPort;
  readonly logger: LoggerPort;
}

export interface PlayMusicInput {
  readonly serverId: string;
  readonly trackId: string;
  readonly player: string;
  readonly range?: number;
}

export interface DownloadMusicInput {
  readonly serverId: string;
  readonly url: string;
  readonly requestedPlayer?: string;
}

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_LIST_LIMIT = 10;
const AUDIO_FORMAT_FLAG = "bestaudio/best";
const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

export class AudioPlayerService {
  private readonly requestLimitLocks = new Map<string, Promise<void>>();

  constructor(private readonly deps: AudioPlayerDependencies) {}

  async searchMusic(query: string): Promise<readonly YoutubeSearchVideo[]> {
    return this.deps.youtube.search({ query, options: { limit: DEFAULT_SEARCH_LIMIT } });
  }

  async downloadMusic(input: DownloadMusicInput): Promise<AudioTrack> {
    return this.withRequestLimitLock(input, () => this.downloadMusicUnlocked(input));
  }

  private async downloadMusicUnlocked(input: DownloadMusicInput): Promise<AudioTrack> {
    const server = await this.requireEnabledServer(input.serverId);
    await this.requireRunning(input.serverId);
    const metadata = await this.deps.metadata.resolve(server.directory);
    await this.enforcePlayerRequestLimit(input.serverId, input.requestedPlayer);

    const config = this.deps.config.getAudioPlayerConfig();
    const trackId = randomUUID();
    const outputDir = path.join(server.directory, metadata.levelName, "audioplayer");
    const outputPath = path.join(outputDir, `${trackId}.${config.downloadFormat}`);
    const videoMetadata = await this.deps.youtube.getMetadata({ url: input.url });

    await mkdir(outputDir, { recursive: true });
    await this.deps.youtube.downloadVideo({
      url: input.url,
      outputPath,
      flags: {
        format: AUDIO_FORMAT_FLAG,
        extractAudio: true,
        audioFormat: config.downloadFormat,
        embedMetadata: true,
        embedThumbnail: true,
        maxFilesize: config.maxDownloadSize,
      },
    });

    const fileStat = await stat(outputPath);
    if (fileStat.size > config.maxDownloadSize) {
      await rm(outputPath, { force: true });
      throw new AudioDownloadTooLargeError(fileStat.size, config.maxDownloadSize);
    }

    const track: AudioTrack = {
      id: trackId,
      serverId: input.serverId,
      url: input.url,
      title: stringField(videoMetadata, "title") ?? input.url,
      duration: numberField(videoMetadata, "duration") ?? 0,
      tags: stringArrayField(videoMetadata, "tags"),
      artist: stringField(videoMetadata, "artist") ?? stringField(videoMetadata, "uploader") ?? "Unknown",
      levelName: metadata.levelName,
      path: outputPath,
      isPlaying: false,
      ...optionalStringProperty("coverImg", stringField(videoMetadata, "thumbnail")),
      dateAdded: new Date().toISOString(),
      size: fileStat.size,
      ...(input.requestedPlayer ? { requestedPlayer: input.requestedPlayer } : {}),
    };

    await this.deps.tracks.save(track);
    this.deps.logger.info("audioplayer.track.downloaded", { serverId: input.serverId, trackId });
    return track;
  }

  async playMusic(input: PlayMusicInput): Promise<AudioTrack> {
    const server = await this.requireEnabledServer(input.serverId);
    await this.requireRunning(input.serverId);
    const track = await this.requireTrack(input.trackId);
    const metadata = await this.deps.metadata.resolve(server.directory);

    if (track.serverId !== input.serverId) {
      throw new AudioTrackNotFoundError(input.trackId);
    }
    if (track.levelName !== metadata.levelName) {
      throw new AudioTrackLevelMismatchError(track.id, track.levelName, metadata.levelName);
    }

    assertValidPlayerName(input.player);
    await this.deps.playerData.getPlayerData(input.serverId, input.player);
    const stoppedTracks = await this.stopPlayingTracksForServer(input.serverId);

    const range = input.range ?? this.deps.config.getAudioPlayerConfig().playbackRange;
    try {
      await this.deps.stdin.sendCommand(
        input.serverId,
        `execute at ${input.player} run audioplayer play ${track.id} ~ ~ ~ ${range}`,
      );

      const updated = { ...track, isPlaying: true };
      await this.deps.tracks.save(updated);
      return updated;
    } catch (error) {
      await this.restorePlayingTracks(stoppedTracks);
      throw error;
    }
  }

  async stopMusic(serverId: string, trackId: string): Promise<AudioTrack> {
    await this.requireEnabledServer(serverId);
    await this.requireRunning(serverId);
    const track = await this.requireTrack(trackId);
    if (track.serverId !== serverId) {
      throw new AudioTrackNotFoundError(trackId);
    }

    await this.deps.stdin.sendCommand(serverId, `audioplayer stop ${track.id}`);
    const updated = { ...track, isPlaying: false };
    await this.deps.tracks.save(updated);
    return updated;
  }

  async deleteMusic(serverId: string, trackId: string): Promise<void> {
    await this.requireEnabledServer(serverId);
    const track = await this.requireTrack(trackId);
    if (track.serverId !== serverId) {
      throw new AudioTrackNotFoundError(trackId);
    }
    if (track.isPlaying) {
      throw new AudioTrackAlreadyPlayingError(trackId);
    }

    await rm(track.path, { force: true });
    await this.deps.tracks.remove(trackId);
  }

  async listMusic(input: ListAudioTracksInput): Promise<readonly AudioTrack[]> {
    await this.requireEnabledServer(input.serverId);
    const query = input.query?.toLowerCase();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const sortBy = input.sortBy ?? "date";
    const sortOrder = input.sortOrder ?? "desc";
    const tracks = await this.deps.tracks.list();
    const filtered = tracks.filter((track) => {
      if (track.serverId !== input.serverId) return false;
      if (!query) return true;
      return track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query);
    });

    return [...filtered]
      .sort((left, right) => compareTracks(left, right, sortBy, sortOrder))
      .slice(0, limit);
  }

  private async requireEnabledServer(serverId: string) {
    const server = await this.deps.minecraftRepository.get(serverId);
    if (server === undefined) {
      throw new MinecraftServerNotFoundError(serverId);
    }
    if (server.features?.audioPlayer?.enabled !== true) {
      throw new AudioPlayerFeatureDisabledError(serverId);
    }
    return server;
  }

  private async requireRunning(serverId: string): Promise<void> {
    const instance = await this.deps.serverRegistry.get(serverId);
    if (instance === undefined || instance.status !== "running") {
      throw new MinecraftServerNotRunningError(serverId);
    }
  }

  private async requireTrack(trackId: string): Promise<AudioTrack> {
    const track = await this.deps.tracks.get(trackId);
    if (track === undefined) {
      throw new AudioTrackNotFoundError(trackId);
    }
    return track;
  }

  private async stopPlayingTracksForServer(serverId: string): Promise<readonly AudioTrack[]> {
    const tracks = await this.deps.tracks.list();
    const playing = tracks.filter((track) => track.serverId === serverId && track.isPlaying);
    for (const track of playing) {
      await this.deps.stdin.sendCommand(serverId, `audioplayer stop ${track.id}`);
      await this.deps.tracks.save({ ...track, isPlaying: false });
    }
    return playing;
  }

  private async restorePlayingTracks(tracks: readonly AudioTrack[]): Promise<void> {
    for (const track of tracks) {
      await this.deps.tracks.save(track);
    }
  }

  private async enforcePlayerRequestLimit(serverId: string, requestedPlayer: string | undefined): Promise<void> {
    if (!requestedPlayer) return;
    const maxPlayerRequest = this.deps.config.getAudioPlayerConfig().maxPlayerRequest;
    const tracks = await this.deps.tracks.list();
    const count = tracks.filter((track) => track.serverId === serverId && track.requestedPlayer === requestedPlayer).length;
    if (count >= maxPlayerRequest) {
      throw new AudioPlayerRequestLimitError(requestedPlayer, maxPlayerRequest);
    }
  }

  private async withRequestLimitLock(input: DownloadMusicInput, action: () => Promise<AudioTrack>): Promise<AudioTrack> {
    if (!input.requestedPlayer) return action();

    const lockKey = `${input.serverId}:${input.requestedPlayer}`;
    const previous = this.requestLimitLocks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const next = previous.then(() => current, () => current);
    this.requestLimitLocks.set(lockKey, next);

    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.requestLimitLocks.get(lockKey) === next) {
        this.requestLimitLocks.delete(lockKey);
      }
    }
  }
}

function optionalStringProperty<TKey extends string>(key: TKey, value: string | undefined): Partial<Record<TKey, string>> {
  return value !== undefined ? { [key]: value } as Record<TKey, string> : {};
}

function assertValidPlayerName(playerName: string): void {
  if (!PLAYER_NAME_PATTERN.test(playerName)) {
    throw new InvalidMinecraftPlayerNameError(playerName);
  }
}

function compareTracks(left: AudioTrack, right: AudioTrack, sortBy: ListAudioTracksInput["sortBy"], sortOrder: ListAudioTracksInput["sortOrder"]): number {
  const direction = sortOrder === "asc" ? 1 : -1;
  const leftValue = sortValue(left, sortBy ?? "date");
  const rightValue = sortValue(right, sortBy ?? "date");
  return (leftValue - rightValue) * direction;
}

function sortValue(track: AudioTrack, sortBy: NonNullable<ListAudioTracksInput["sortBy"]>): number {
  switch (sortBy) {
    case "duration":
      return track.duration;
    case "size":
      return track.size;
    case "date":
    default:
      return finiteNumberOrZero(Date.parse(track.dateAdded));
  }
}

function finiteNumberOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function stringField(metadata: YoutubeVideoMetadata, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(metadata: YoutubeVideoMetadata, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(metadata: YoutubeVideoMetadata, key: string): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
