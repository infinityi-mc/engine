import type { YoutubeDownloadPort } from "../domain/ports/youtube-download.port";
import type { YoutubeSearchPort } from "../domain/ports/youtube-search.port";
import type {
  YoutubeDownloadInput,
  YoutubeDownloadResult,
  YoutubeMetadataInput,
  YoutubeSearchInput,
  YoutubeSearchVideo,
  YoutubeVideoMetadata,
} from "../domain/types/youtube.types";

export class YoutubeService {
  constructor(
    private readonly searchPort: YoutubeSearchPort,
    private readonly downloadPort: YoutubeDownloadPort,
  ) {}

  search(input: YoutubeSearchInput): Promise<readonly YoutubeSearchVideo[]> {
    return this.searchPort.search(input);
  }

  getMetadata(input: YoutubeMetadataInput): Promise<YoutubeVideoMetadata> {
    return this.downloadPort.getMetadata(input);
  }

  downloadVideo(input: YoutubeDownloadInput): Promise<YoutubeDownloadResult> {
    return this.downloadPort.downloadVideo(input);
  }
}
