import type {
  YoutubeDownloadInput,
  YoutubeDownloadResult,
  YoutubeMetadataInput,
  YoutubeVideoMetadata,
} from "../types/youtube.types";

export interface YoutubeDownloadPort {
  getMetadata(input: YoutubeMetadataInput): Promise<YoutubeVideoMetadata>;
  downloadVideo(input: YoutubeDownloadInput): Promise<YoutubeDownloadResult>;
}
