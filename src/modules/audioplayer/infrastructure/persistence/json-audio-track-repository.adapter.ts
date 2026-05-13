import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { AudioTrackRepositoryPort } from "../../domain/ports/audio-track-repository.port";
import type { AudioTrack } from "../../domain/types/audio-track";

interface AudioTrackStore {
  readonly tracks: Record<string, AudioTrack>;
}

export class JsonAudioTrackRepositoryAdapter implements AudioTrackRepositoryPort {
  private readonly filePath: string;
  private readonly tracks = new Map<string, AudioTrack>();
  private loaded = false;

  constructor(
    dataDir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = path.join(dataDir, "audioplayer", "tracks.json");
  }

  async get(id: string): Promise<AudioTrack | undefined> {
    await this.ensureLoaded();
    return this.tracks.get(id);
  }

  async list(): Promise<readonly AudioTrack[]> {
    await this.ensureLoaded();
    return [...this.tracks.values()];
  }

  async save(track: AudioTrack): Promise<void> {
    await this.ensureLoaded();
    this.tracks.set(track.id, track);
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    const deleted = this.tracks.delete(id);
    if (!deleted) return;
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await readFile(this.filePath, "utf8");
      const store = JSON.parse(content) as Partial<AudioTrackStore>;
      for (const [id, track] of Object.entries(store.tracks ?? {})) {
        if (!isAudioTrackLike(id, track)) {
          this.logger.warn("audioplayer.repository.invalid_track_skipped", {
            module: "audioplayer",
            operation: "repository.load",
            trackId: id,
          });
          continue;
        }
        this.tracks.set(id, { ...track, id });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        this.logger.warn("audioplayer.repository.load_error", {
          module: "audioplayer",
          operation: "repository.load",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const store: AudioTrackStore = {
      tracks: Object.fromEntries(this.tracks),
    };
    const json = JSON.stringify(store, null, 2);
    const tempPath = this.filePath + ".tmp";

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(tempPath, json, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function isAudioTrackLike(id: string, value: unknown): value is AudioTrack {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const track = value as Partial<AudioTrack>;
  return id.length > 0 &&
    typeof track.serverId === "string" &&
    typeof track.url === "string" &&
    typeof track.title === "string" &&
    typeof track.artist === "string" &&
    typeof track.levelName === "string" &&
    typeof track.path === "string" &&
    typeof track.dateAdded === "string" &&
    typeof track.duration === "number" &&
    typeof track.size === "number" &&
    typeof track.isPlaying === "boolean" &&
    Array.isArray(track.tags) &&
    track.tags.every((tag) => typeof tag === "string");
}
