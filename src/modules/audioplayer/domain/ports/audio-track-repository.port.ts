import type { AudioTrack } from "../types/audio-track";

export interface AudioTrackRepositoryPort {
  get(id: string): Promise<AudioTrack | undefined>;
  list(): Promise<readonly AudioTrack[]>;
  save(track: AudioTrack): Promise<void>;
  remove(id: string): Promise<void>;
}
