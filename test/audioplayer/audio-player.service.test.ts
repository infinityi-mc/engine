import { describe, expect, test } from "bun:test";
import { AudioPlayerService } from "../../src/modules/audioplayer/application/audio-player.service";
import { AudioPlayerFeatureDisabledError, AudioTrackAlreadyPlayingError } from "../../src/modules/audioplayer/domain/errors/audio-player.errors";
import type { AudioTrackRepositoryPort } from "../../src/modules/audioplayer/domain/ports/audio-track-repository.port";
import type { AudioTrack } from "../../src/modules/audioplayer/domain/types/audio-track";
import type { MinecraftServerRepositoryPort } from "../../src/modules/minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../src/modules/minecraft/domain/ports/minecraft-stdin.port";
import type { GetPlayerDataPort } from "../../src/modules/minecraft/domain/ports/get-player-data.port";
import type { ServerMetadataPort } from "../../src/modules/minecraft/domain/ports/server-metadata.port";
import type { MinecraftServer } from "../../src/modules/minecraft/domain/types/minecraft-server";
import type { PlayerDataResult } from "../../src/modules/minecraft/domain/types/player-data";
import type { ServerRegistryPort } from "../../src/modules/server/domain/ports/server-registry.port";
import type { ServerInstance } from "../../src/modules/server/domain/types/server-instance";
import type { YoutubeService } from "../../src/modules/youtube/application/youtube.service";
import type { ConfigPort } from "../../src/shared/config/config.port";
import { noopLogger } from "../../src/shared/observability/logger.port";

function fakeServer(overrides: Partial<MinecraftServer> = {}): MinecraftServer {
  return {
    id: "survival",
    name: "Survival",
    directory: "/srv/minecraft",
    javaPath: "java",
    jarFile: "server.jar",
    jvmArgs: [],
    serverArgs: ["--nogui"],
    features: { audioPlayer: { enabled: true } },
    ...overrides,
  };
}

function fakeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: "track-1",
    serverId: "survival",
    url: "https://youtube.test/watch?v=1",
    title: "Track",
    duration: 120,
    tags: [],
    artist: "Artist",
    levelName: "world",
    path: "/srv/minecraft/world/audioplayer/track-1.mp3",
    isPlaying: false,
    dateAdded: "2026-01-01T00:00:00.000Z",
    size: 1024,
    ...overrides,
  };
}

function fakeRepository(tracks: AudioTrack[] = []): AudioTrackRepositoryPort {
  const map = new Map(tracks.map((track) => [track.id, track]));
  return {
    get: async (id) => map.get(id),
    list: async () => [...map.values()],
    save: async (track) => { map.set(track.id, track); },
    remove: async (id) => { map.delete(id); },
  };
}

function createService(input: {
  readonly server?: MinecraftServer;
  readonly tracks?: AudioTrack[];
  readonly commands?: string[];
} = {}): AudioPlayerService {
  const commands = input.commands ?? [];
  const server = input.server ?? fakeServer();
  const minecraftRepository: MinecraftServerRepositoryPort = {
    get: async (id) => id === server.id ? server : undefined,
    list: async () => [server],
    save: async () => {},
    remove: async () => {},
  };
  const serverRegistry: ServerRegistryPort = {
    get: async (): Promise<ServerInstance> => ({
      id: server.id,
      pid: 1,
      command: "java",
      args: [],
      cwd: server.directory,
      status: "running",
      startedAt: new Date(),
      stoppedAt: undefined,
    }),
    list: async () => [],
    register: async () => {},
    unregister: async () => {},
    updateStatus: async () => {},
  };
  const stdin: MinecraftStdinPort = {
    sendCommand: async (_serverId, command) => { commands.push(command); },
  };
  const metadata: ServerMetadataPort = {
    resolve: async () => ({
      levelName: "world",
      maxPlayers: 20,
      serverPort: 25565,
      levelInfo: {
        isRunning: true,
        worldName: "world",
        minecraftVersion: "1.21.1",
        serverBrands: ["fabric"],
      },
    }),
  };
  const playerData: GetPlayerDataPort = {
    getPlayerData: async (serverId, playerName): Promise<PlayerDataResult> => ({
      serverId,
      playerName,
      data: {},
    }),
  };
  const youtube = {
    search: async () => [],
    getMetadata: async () => ({}),
    downloadVideo: async () => ({ outputPath: "", result: {} }),
  } as unknown as YoutubeService;
  const config = {
    getConfig: () => ({
      llm: { defaultProvider: "none", defaultModel: "none", providers: {} },
      audioPlayer: {
        maxDownloadSize: 15 * 1024 * 1024,
        downloadFormat: "mp3",
        maxPlayerRequest: 20,
        playbackRange: 48,
      },
    }),
    getAudioPlayerConfig: () => ({
      maxDownloadSize: 15 * 1024 * 1024,
      downloadFormat: "mp3",
      maxPlayerRequest: 20,
      playbackRange: 48,
    }),
  } as ConfigPort;

  return new AudioPlayerService({
    tracks: fakeRepository(input.tracks),
    minecraftRepository,
    serverRegistry,
    stdin,
    metadata,
    playerData,
    youtube,
    config,
    logger: noopLogger,
  });
}

describe("AudioPlayerService", () => {
  test("requires strict per-server audioPlayer feature opt-in", async () => {
    const service = createService({
      server: {
        id: "survival",
        name: "Survival",
        directory: "/srv/minecraft",
        javaPath: "java",
        jarFile: "server.jar",
        jvmArgs: [],
        serverArgs: ["--nogui"],
      },
    });

    await expect(service.listMusic({ serverId: "survival" })).rejects.toThrow(AudioPlayerFeatureDisabledError);
  });

  test("stops existing server playback before playing requested track", async () => {
    const commands: string[] = [];
    const service = createService({
      commands,
      tracks: [
        fakeTrack({ id: "old-track", isPlaying: true }),
        fakeTrack({ id: "new-track" }),
      ],
    });

    const played = await service.playMusic({ serverId: "survival", trackId: "new-track", player: "Steve" });

    expect(played.isPlaying).toBe(true);
    expect(commands).toEqual([
      "audioplayer stop old-track",
      "execute at Steve run audioplayer play new-track ~ ~ ~ 48",
    ]);
  });

  test("blocks deleting a playing track", async () => {
    const service = createService({ tracks: [fakeTrack({ isPlaying: true })] });

    await expect(service.deleteMusic("survival", "track-1")).rejects.toThrow(AudioTrackAlreadyPlayingError);
  });
});
