import type { YoutubeSearchInput, YoutubeSearchVideo } from "../types/youtube.types";

export interface YoutubeSearchPort {
  search(input: YoutubeSearchInput): Promise<readonly YoutubeSearchVideo[]>;
}
