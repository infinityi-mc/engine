export interface YoutubeSearchOptions {
  readonly limit?: number;
}

export interface YoutubeSearchInput {
  readonly query: string;
  readonly options?: YoutubeSearchOptions;
}

export interface YoutubeAuthorSummary {
  readonly name?: string;
  readonly url?: string;
}

export interface YoutubeSearchVideo {
  readonly videoId: string;
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly durationSeconds?: number;
  readonly durationText?: string;
  readonly views?: number;
  readonly author?: YoutubeAuthorSummary;
  readonly thumbnailUrl?: string;
  readonly uploadedAt?: string;
}

export type YoutubeDlpFlagValue = string | number | boolean | readonly string[] | undefined;

export type YoutubeDlpFlags = Readonly<Record<string, YoutubeDlpFlagValue>>;

export type YoutubeVideoMetadata = Readonly<Record<string, unknown>>;

export interface YoutubeMetadataInput {
  readonly url: string;
  readonly flags?: YoutubeDlpFlags;
}

export interface YoutubeDownloadInput {
  readonly url: string;
  readonly outputPath: string;
  readonly flags?: YoutubeDlpFlags;
}

export interface YoutubeDownloadResult {
  readonly outputPath: string;
  readonly result: unknown;
}
