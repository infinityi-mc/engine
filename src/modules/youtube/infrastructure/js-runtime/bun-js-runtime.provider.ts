import path from "node:path";
import type { YoutubeJsRuntime, YoutubeJsRuntimePort } from "./youtube-js-runtime.port";

export interface BunJsRuntimeProviderOptions {
  readonly runtimePath?: string;
}

export class BunJsRuntimeProvider implements YoutubeJsRuntimePort {
  private readonly runtimePath: string;

  constructor(options: BunJsRuntimeProviderOptions = {}) {
    this.runtimePath = options.runtimePath ?? process.execPath;
  }

  getJsRuntime(): YoutubeJsRuntime {
    return `bun:${path.resolve(this.runtimePath)}`;
  }
}
