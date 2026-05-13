declare module "yt-search" {
  export interface YtSearchAuthor {
    readonly name?: string;
    readonly url?: string;
  }

  export interface YtSearchDuration {
    readonly seconds?: number;
    readonly timestamp?: string;
  }

  export interface YtSearchVideo {
    readonly videoId?: string;
    readonly url?: string;
    readonly title?: string;
    readonly description?: string;
    readonly duration?: YtSearchDuration;
    readonly timestamp?: string;
    readonly views?: number;
    readonly author?: YtSearchAuthor;
    readonly thumbnail?: string;
    readonly image?: string;
    readonly ago?: string;
  }

  export interface YtSearchResult {
    readonly videos: readonly YtSearchVideo[];
  }

  export interface YtSearchVideoLookup {
    readonly videoId: string;
  }

  export interface YtSearchPlaylistLookup {
    readonly listId: string;
  }

  export interface YtSearchQuery {
    readonly query: string;
  }

  export default function ytSearch(
    input: string | YtSearchQuery | YtSearchVideoLookup | YtSearchPlaylistLookup,
  ): Promise<YtSearchResult | YtSearchVideo>;
}
