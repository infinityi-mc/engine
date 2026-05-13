import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { noopLogger } from "../../../../shared/observability/logger.port";
import { getErrorMessage, getErrorName } from "../../../../shared/observability/error-utils";
import type { YoutubeFfmpegPort } from "./youtube-ffmpeg.port";
import { YoutubeFfmpegError, YoutubeFfmpegUnsupportedPlatformError } from "./youtube-ffmpeg.errors";

const WINDOWS_FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";
const LINUX_FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-lgpl.tar.xz";
const EXECUTABLE_MODE = 0o755;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

type SupportedFfmpegPlatform = "win32-x64" | "linux-x64";
type FetchArchive = (url: string, init?: RequestInit) => Promise<Response>;
type ExtractArchive = (archivePath: string, destinationDir: string, platform: SupportedFfmpegPlatform) => Promise<void>;

export interface YoutubeFfmpegManagerOptions {
  readonly binDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly fetchArchive?: FetchArchive;
  readonly extractArchive?: ExtractArchive;
  readonly downloadTimeoutMs?: number;
  readonly logger?: LoggerPort;
}

export class YoutubeFfmpegManager implements YoutubeFfmpegPort {
  private readonly binDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: NodeJS.Architecture;
  private readonly fetchArchive: FetchArchive;
  private readonly extractArchive: ExtractArchive;
  private readonly downloadTimeoutMs: number;
  private readonly logger: LoggerPort;
  private pendingEnsure: Promise<string> | undefined;

  constructor(options: YoutubeFfmpegManagerOptions = {}) {
    this.binDir = options.binDir ?? path.join(process.cwd(), "bin");
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetchArchive = options.fetchArchive ?? fetch;
    this.extractArchive = options.extractArchive ?? extractWithPlatformTool;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    this.logger = options.logger ?? noopLogger;
  }

  async ensureFfmpeg(): Promise<string> {
    if (this.pendingEnsure) {
      return this.pendingEnsure;
    }

    this.pendingEnsure = this.ensureFfmpegOnce().finally(() => {
      this.pendingEnsure = undefined;
    });

    return this.pendingEnsure;
  }

  private async ensureFfmpegOnce(): Promise<string> {
    const platform = this.getSupportedPlatform();
    const ffmpegPath = this.getExecutablePath("ffmpeg", platform);
    const ffprobePath = this.getExecutablePath("ffprobe", platform);
    if (await fileExists(ffmpegPath) && await fileExists(ffprobePath)) {
      return this.binDir;
    }

    await this.downloadAndInstall(platform, ffmpegPath, ffprobePath);
    return this.binDir;
  }

  private async downloadAndInstall(platform: SupportedFfmpegPlatform, ffmpegPath: string, ffprobePath: string): Promise<void> {
    const url = getArchiveUrl(platform);
    const tempId = `${process.pid}.${randomUUID()}`;
    const archivePath = path.join(this.binDir, `ffmpeg.${tempId}${getArchiveExtension(platform)}`);
    const extractDir = path.join(this.binDir, `ffmpeg.${tempId}`);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.downloadTimeoutMs);

    try {
      await mkdir(this.binDir, { recursive: true });
      const response = await this.fetchArchive(url, { signal: abortController.signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new YoutubeFfmpegError(`Failed to download ffmpeg: ${response.status} ${response.statusText}`);
      }
      if (!response.body) {
        throw new YoutubeFfmpegError("Failed to download ffmpeg: response body is empty");
      }

      await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
      await mkdir(extractDir, { recursive: true });
      await this.extractArchive(archivePath, extractDir, platform);
      await installExecutable(extractDir, "ffmpeg", ffmpegPath, platform);
      await installExecutable(extractDir, "ffprobe", ffprobePath, platform);

      this.logger.info("youtube.ffmpeg.installed", {
        module: "youtube",
        operation: "ffmpeg.ensure",
        platform,
        binDir: this.binDir,
      });
    } catch (error) {
      this.logger.error("youtube.ffmpeg.install_error", {
        module: "youtube",
        operation: "ffmpeg.ensure",
        platform,
        binDir: this.binDir,
        url,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      await rm(archivePath, { force: true }).catch(() => undefined);
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private getExecutablePath(name: "ffmpeg" | "ffprobe", platform: SupportedFfmpegPlatform): string {
    return path.join(this.binDir, platform === "win32-x64" ? `${name}.exe` : name);
  }

  private getSupportedPlatform(): SupportedFfmpegPlatform {
    if (this.platform === "win32" && this.arch === "x64") {
      return "win32-x64";
    }
    if (this.platform === "linux" && this.arch === "x64") {
      return "linux-x64";
    }

    throw new YoutubeFfmpegUnsupportedPlatformError(this.platform, this.arch);
  }
}

async function extractWithPlatformTool(archivePath: string, destinationDir: string, platform: SupportedFfmpegPlatform): Promise<void> {
  const command = platform === "win32-x64"
    ? ["powershell.exe", "-NoProfile", "-Command", `Expand-Archive -LiteralPath ${quotePowerShellString(archivePath)} -DestinationPath ${quotePowerShellString(destinationDir)} -Force`]
    : ["tar", "-xJf", archivePath, "-C", destinationDir];
  const subprocess = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new YoutubeFfmpegError(`Failed to extract ffmpeg archive: ${stderr.trim()}`);
  }
}

function quotePowerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function installExecutable(sourceDir: string, executableName: "ffmpeg" | "ffprobe", destinationPath: string, platform: SupportedFfmpegPlatform): Promise<void> {
  const sourcePath = await findExecutable(sourceDir, platform === "win32-x64" ? `${executableName}.exe` : executableName);
  const tempPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  await copyFile(sourcePath, tempPath);
  if (platform === "linux-x64") {
    await chmod(tempPath, EXECUTABLE_MODE);
  }
  await rename(tempPath, destinationPath);
}

async function findExecutable(directory: string, filename: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const match = await findExecutable(entryPath, filename).catch(() => undefined);
      if (match) {
        return match;
      }
    }
  }

  throw new YoutubeFfmpegError(`Missing ${filename} in ffmpeg archive`);
}

function getArchiveUrl(platform: SupportedFfmpegPlatform): string {
  return platform === "win32-x64" ? WINDOWS_FFMPEG_URL : LINUX_FFMPEG_URL;
}

function getArchiveExtension(platform: SupportedFfmpegPlatform): string {
  return platform === "win32-x64" ? ".zip" : ".tar.xz";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
