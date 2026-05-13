import { create as createYoutubeDl } from "youtube-dl-exec";
import type { Flags, Payload } from "youtube-dl-exec";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { noopLogger } from "../../../../shared/observability/logger.port";
import { getErrorMessage } from "../../../../shared/observability/error-utils";
import { YoutubeDownloadError } from "../../domain/errors/youtube.errors";
import type { YoutubeDownloadPort } from "../../domain/ports/youtube-download.port";
import type {
  YoutubeDownloadInput,
  YoutubeDownloadResult,
  YoutubeDlpFlags,
  YoutubeMetadataInput,
  YoutubeVideoMetadata,
} from "../../domain/types/youtube.types";
import type { YoutubeBinaryPort } from "../binary/youtube-binary.port";
import type { YoutubeFfmpegPort } from "../ffmpeg/youtube-ffmpeg.port";
import type { YoutubeJsRuntimePort } from "../js-runtime/youtube-js-runtime.port";

export type YoutubeDlClient = (url: string, flags?: Flags) => Promise<unknown>;
export type YoutubeDlFactory = (binaryPath: string) => YoutubeDlClient;

export class YoutubeDlExecAdapter implements YoutubeDownloadPort {
  constructor(
    private readonly binaryManager: YoutubeBinaryPort,
    private readonly createClient: YoutubeDlFactory = createYoutubeDl,
    private readonly logger: LoggerPort = noopLogger,
    private readonly ffmpegManager?: YoutubeFfmpegPort,
    private readonly jsRuntimeProvider?: YoutubeJsRuntimePort,
  ) {}

  async getMetadata(input: YoutubeMetadataInput): Promise<YoutubeVideoMetadata> {
    try {
      const binaryPath = await this.binaryManager.ensureBinary();
      const flags = toYoutubeDlFlags(input.flags);
      const client = this.createClient(binaryPath);
      const metadata = await client(input.url, {
        ...withDefaultJsRuntime(flags, this.jsRuntimeProvider),
        dumpSingleJson: true,
        skipDownload: true,
        noWarnings: true,
      });

      this.logger.info("youtube.metadata.fetched", {
        module: "youtube",
        operation: "metadata.fetch",
        binaryPath,
      });

      return metadata as Payload as YoutubeVideoMetadata;
    } catch (error) {
      throw new YoutubeDownloadError(`Failed to fetch YouTube metadata: ${getErrorMessage(error)}`, { cause: error });
    }
  }

  async downloadVideo(input: YoutubeDownloadInput): Promise<YoutubeDownloadResult> {
    try {
      const binaryPath = await this.binaryManager.ensureBinary();
      const flags = toYoutubeDlFlags(input.flags);
      const ffmpegLocation = flags.ffmpegLocation === undefined
        ? await this.ffmpegManager?.ensureFfmpeg()
        : undefined;
      const client = this.createClient(binaryPath);
      const result = await client(input.url, {
        ...withDefaultJsRuntime(flags, this.jsRuntimeProvider),
        ...(ffmpegLocation !== undefined ? { ffmpegLocation } : {}),
        output: input.outputPath,
      });

      this.logger.info("youtube.video.downloaded", {
        module: "youtube",
        operation: "video.download",
        binaryPath,
        outputPath: input.outputPath,
      });

      return {
        outputPath: input.outputPath,
        result,
      };
    } catch (error) {
      throw new YoutubeDownloadError(`Failed to download YouTube video: ${getErrorMessage(error)}`, { cause: error });
    }
  }
}

function toYoutubeDlFlags(flags: YoutubeDlpFlags | undefined): Flags {
  if (!flags) {
    return {};
  }

  const entries = Object.entries(flags).flatMap(([key, value]) => {
    if (value === undefined) {
      return [];
    }

    return [[key, Array.isArray(value) ? [...value] : value]];
  });

  return Object.fromEntries(entries) as Flags;
}

function withDefaultJsRuntime(flags: Flags, jsRuntimeProvider: YoutubeJsRuntimePort | undefined): Flags {
  if (flags.jsRuntimes !== undefined || jsRuntimeProvider === undefined) {
    return flags;
  }

  return {
    ...flags,
    jsRuntimes: jsRuntimeProvider.getJsRuntime(),
  };
}
