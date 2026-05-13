import type { JSRuntime } from "youtube-dl-exec";

export type YoutubeJsRuntime = JSRuntime | `${JSRuntime}:${string}`;

export interface YoutubeJsRuntimePort {
  getJsRuntime(): YoutubeJsRuntime;
}
