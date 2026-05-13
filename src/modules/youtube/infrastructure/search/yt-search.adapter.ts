import ytSearch from "yt-search";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { noopLogger } from "../../../../shared/observability/logger.port";
import type { YoutubeSearchPort } from "../../domain/ports/youtube-search.port";
import type { YoutubeSearchInput, YoutubeSearchVideo } from "../../domain/types/youtube.types";
import type { YtSearchResult, YtSearchVideo } from "yt-search";

type SearchFunction = typeof ytSearch;

export class YtSearchAdapter implements YoutubeSearchPort {
  constructor(
    private readonly searchClient: SearchFunction = ytSearch,
    private readonly logger: LoggerPort = noopLogger,
  ) {}

  async search(input: YoutubeSearchInput): Promise<readonly YoutubeSearchVideo[]> {
    const result = await this.searchClient(input.query);
    if (!isSearchResult(result)) {
      return [];
    }

    const limit = input.options?.limit;
    const normalizedVideos = result.videos.flatMap(normalizeVideo);
    const normalized = limit === undefined ? normalizedVideos : normalizedVideos.slice(0, limit);

    this.logger.info("youtube.search.completed", {
      module: "youtube",
      operation: "search",
      resultCount: normalized.length,
    });

    return normalized;
  }
}

function isSearchResult(result: Awaited<ReturnType<SearchFunction>>): result is YtSearchResult {
  return typeof result === "object" && result !== null && "videos" in result && Array.isArray(result.videos);
}

function normalizeVideo(video: YtSearchVideo): readonly YoutubeSearchVideo[] {
  if (!video.videoId || !video.url || !video.title) {
    return [];
  }

  const normalized: YoutubeSearchVideo = {
    videoId: video.videoId,
    url: video.url,
    title: video.title,
    ...(video.description !== undefined ? { description: video.description } : {}),
    ...(video.duration?.seconds !== undefined ? { durationSeconds: video.duration.seconds } : {}),
    ...(video.duration?.timestamp !== undefined ? { durationText: video.duration.timestamp } : {}),
    ...(video.views !== undefined ? { views: video.views } : {}),
    ...(video.author !== undefined ? { author: compactAuthor(video.author) } : {}),
    ...(video.thumbnail !== undefined ? { thumbnailUrl: video.thumbnail } : {}),
    ...(video.thumbnail === undefined && video.image !== undefined ? { thumbnailUrl: video.image } : {}),
    ...(video.ago !== undefined ? { uploadedAt: video.ago } : {}),
  };

  return [normalized];
}

function compactAuthor(author: NonNullable<YtSearchVideo["author"]>) {
  return {
    ...(author.name !== undefined ? { name: author.name } : {}),
    ...(author.url !== undefined ? { url: author.url } : {}),
  };
}
