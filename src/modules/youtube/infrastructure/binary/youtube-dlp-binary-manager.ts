import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { noopLogger } from "../../../../shared/observability/logger.port";
import { getErrorMessage, getErrorName } from "../../../../shared/observability/error-utils";
import type { YoutubeBinaryPort } from "./youtube-binary.port";
import { YoutubeBinaryError, YoutubeUnsupportedPlatformError } from "./youtube-binary.errors";

const WINDOWS_BINARY_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const LINUX_BINARY_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const LINUX_BINARY_MODE = 0o755;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

type SupportedPlatform = "win32" | "linux";
type FetchBinary = (url: string, init?: RequestInit) => Promise<Response>;

export interface YoutubeDlpBinaryManagerOptions {
  readonly binDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly fetchBinary?: FetchBinary;
  readonly downloadTimeoutMs?: number;
  readonly logger?: LoggerPort;
}

export class YoutubeDlpBinaryManager implements YoutubeBinaryPort {
  private readonly binDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly fetchBinary: FetchBinary;
  private readonly downloadTimeoutMs: number;
  private readonly logger: LoggerPort;
  private pendingEnsure: Promise<string> | undefined;

  constructor(options: YoutubeDlpBinaryManagerOptions = {}) {
    this.binDir = options.binDir ?? path.join(process.cwd(), "bin");
    this.platform = options.platform ?? process.platform;
    this.fetchBinary = options.fetchBinary ?? fetch;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    this.logger = options.logger ?? noopLogger;
  }

  getBinaryPath(): string {
    return path.join(this.binDir, getBinaryFilename(this.getSupportedPlatform()));
  }

  async ensureBinary(): Promise<string> {
    const binaryPath = this.getBinaryPath();
    if (this.pendingEnsure) {
      return this.pendingEnsure;
    }

    this.pendingEnsure = this.ensureBinaryOnce(binaryPath).finally(() => {
      this.pendingEnsure = undefined;
    });

    return this.pendingEnsure;
  }

  private async ensureBinaryOnce(binaryPath: string): Promise<string> {
    if (await fileExists(binaryPath)) {
      return binaryPath;
    }

    return this.downloadBinary(binaryPath);
  }

  private async downloadBinary(binaryPath: string): Promise<string> {
    const platform = this.getSupportedPlatform();
    const url = getBinaryUrl(platform);
    const tempPath = `${binaryPath}.${process.pid}.${randomUUID()}.tmp`;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.downloadTimeoutMs);

    try {
      await mkdir(this.binDir, { recursive: true });

      const response = await this.fetchBinary(url, { signal: abortController.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new YoutubeBinaryError(`Failed to download youtube-dlp: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new YoutubeBinaryError("Failed to download youtube-dlp: response body is empty");
      }

      await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));

      if (platform === "linux") {
        await chmod(tempPath, LINUX_BINARY_MODE);
      }

      await rename(tempPath, binaryPath);

      this.logger.info("youtube.binary.downloaded", {
        module: "youtube",
        operation: "binary.ensure",
        platform,
        binaryPath,
      });

      return binaryPath;
    } catch (error) {
      this.logger.error("youtube.binary.download_error", {
        module: "youtube",
        operation: "binary.ensure",
        platform,
        binaryPath,
        url,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      });

      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getSupportedPlatform(): SupportedPlatform {
    if (this.platform === "win32" || this.platform === "linux") {
      return this.platform;
    }

    throw new YoutubeUnsupportedPlatformError(this.platform);
  }
}

function getBinaryFilename(platform: SupportedPlatform): string {
  return platform === "win32" ? "youtube-dlp.exe" : "youtube-dlp";
}

function getBinaryUrl(platform: SupportedPlatform): string {
  return platform === "win32" ? WINDOWS_BINARY_URL : LINUX_BINARY_URL;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
