export type AudioTrackSortBy = "date" | "duration" | "size";
export type SortOrder = "asc" | "desc";

export interface AudioTrack {
  readonly id: string;
  readonly serverId: string;
  readonly url: string;
  readonly title: string;
  readonly duration: number;
  readonly tags: readonly string[];
  readonly artist: string;
  readonly worldName: string;
  readonly path: string;
  readonly isPlaying: boolean;
  readonly coverImg?: string;
  readonly dateAdded: string;
  readonly size: number;
  readonly requestedPlayer?: string;
}

export interface ListAudioTracksInput {
  readonly serverId: string;
  readonly query?: string;
  readonly limit?: number;
  readonly sortBy?: AudioTrackSortBy;
  readonly sortOrder?: SortOrder;
}
