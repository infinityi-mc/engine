import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { YoutubeService } from "../../src/modules/youtube/application/youtube.service";
import { YoutubeDlpBinaryManager } from "../../src/modules/youtube/infrastructure/binary/youtube-dlp-binary-manager";
import { YoutubeDlExecAdapter } from "../../src/modules/youtube/infrastructure/download/youtube-dl-exec.adapter";
import { YoutubeFfmpegManager } from "../../src/modules/youtube/infrastructure/ffmpeg/youtube-ffmpeg-manager";
import { BunJsRuntimeProvider } from "../../src/modules/youtube/infrastructure/js-runtime/bun-js-runtime.provider";
import { YtSearchAdapter } from "../../src/modules/youtube/infrastructure/search/yt-search.adapter";
import type { YoutubeDownloadPort } from "../../src/modules/youtube/domain/ports/youtube-download.port";
import type { YoutubeSearchPort } from "../../src/modules/youtube/domain/ports/youtube-search.port";
import type { YoutubeSearchInput } from "../../src/modules/youtube/domain/types/youtube.types";
import { YoutubeDownloadError } from "../../src/modules/youtube/domain/errors/youtube.errors";
import { YoutubeUnsupportedPlatformError } from "../../src/modules/youtube/infrastructure/binary/youtube-binary.errors";
import { YoutubeFfmpegUnsupportedPlatformError } from "../../src/modules/youtube/infrastructure/ffmpeg/youtube-ffmpeg.errors";
import { noopLogger } from "../../src/shared/observability/logger.port";

describe("youtube module", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "youtube-module-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("lazily downloads the platform-specific Windows binary once", async () => {
    const requestedUrls: string[] = [];
    const manager = new YoutubeDlpBinaryManager({
      binDir: directory,
      platform: "win32",
      logger: noopLogger,
      fetchBinary: async (url) => {
        requestedUrls.push(url);
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    });

    const firstPath = await manager.ensureBinary();
    const secondPath = await manager.ensureBinary();
    const bytes = await readFile(firstPath);

    expect(firstPath).toBe(path.join(directory, "youtube-dlp.exe"));
    expect(secondPath).toBe(firstPath);
    expect(bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(requestedUrls).toEqual(["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"]);
  });

  test("serializes concurrent binary ensure calls", async () => {
    let fetchCount = 0;
    const manager = new YoutubeDlpBinaryManager({
      binDir: directory,
      platform: "win32",
      logger: noopLogger,
      fetchBinary: async () => {
        fetchCount += 1;
        await Bun.sleep(10);
        return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
      },
    });

    const [firstPath, secondPath] = await Promise.all([
      manager.ensureBinary(),
      manager.ensureBinary(),
    ]);

    expect(firstPath).toBe(secondPath);
    expect(fetchCount).toBe(1);
  });

  test("passes a timeout signal to binary downloads", async () => {
    let sawSignal = false;
    const manager = new YoutubeDlpBinaryManager({
      binDir: directory,
      platform: "win32",
      logger: noopLogger,
      fetchBinary: async (_url, init) => {
        sawSignal = init?.signal instanceof AbortSignal;
        return new Response(new Uint8Array([7, 8, 9]), { status: 200 });
      },
    });

    await manager.ensureBinary();

    expect(sawSignal).toBe(true);
  });

  test("rejects unsupported youtube-dlp platforms", () => {
    const manager = new YoutubeDlpBinaryManager({
      binDir: directory,
      platform: "darwin",
      logger: noopLogger,
    });

    expect(() => manager.getBinaryPath()).toThrow(YoutubeUnsupportedPlatformError);
  });

  test("installs ffmpeg and ffprobe into bin", async () => {
    const requestedUrls: string[] = [];
    const manager = new YoutubeFfmpegManager({
      binDir: directory,
      platform: "win32",
      arch: "x64",
      logger: noopLogger,
      fetchArchive: async (url) => {
        requestedUrls.push(url);
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
      extractArchive: async (_archivePath, destinationDir) => {
        const nestedBinDir = path.join(destinationDir, "ffmpeg-build", "bin");
        await mkdir(nestedBinDir, { recursive: true });
        await writeFile(path.join(nestedBinDir, "ffmpeg.exe"), "ffmpeg", "utf8");
        await writeFile(path.join(nestedBinDir, "ffprobe.exe"), "ffprobe", "utf8");
      },
    });

    const binDir = await manager.ensureFfmpeg();
    const secondBinDir = await manager.ensureFfmpeg();

    expect(binDir).toBe(directory);
    expect(secondBinDir).toBe(directory);
    expect(await readFile(path.join(directory, "ffmpeg.exe"), "utf8")).toBe("ffmpeg");
    expect(await readFile(path.join(directory, "ffprobe.exe"), "utf8")).toBe("ffprobe");
    expect(requestedUrls).toEqual(["https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip"]);
  });

  test("rejects unsupported ffmpeg platforms", async () => {
    const manager = new YoutubeFfmpegManager({
      binDir: directory,
      platform: "linux",
      arch: "arm64",
      logger: noopLogger,
    });

    await expect(manager.ensureFfmpeg()).rejects.toThrow(YoutubeFfmpegUnsupportedPlatformError);
  });

  test("normalizes yt-search video results and applies caller limit", async () => {
    const adapter = new YtSearchAdapter(async () => ({
      videos: [
        {
          videoId: "video-1",
          url: "https://youtube.test/watch?v=video-1",
          title: "One",
          duration: { seconds: 60, timestamp: "1:00" },
          views: 10,
          author: { name: "Channel" },
          thumbnail: "https://img.test/1.jpg",
        },
        {
          url: "https://youtube.test/watch?v=malformed",
          title: "Malformed",
        },
        {
          videoId: "video-2",
          url: "https://youtube.test/watch?v=video-2",
          title: "Two",
        },
      ],
    }), noopLogger);

    const results = await adapter.search({ query: "test", options: { limit: 1 } });

    expect(results).toEqual([
      {
        videoId: "video-1",
        url: "https://youtube.test/watch?v=video-1",
        title: "One",
        durationSeconds: 60,
        durationText: "1:00",
        views: 10,
        author: { name: "Channel" },
        thumbnailUrl: "https://img.test/1.jpg",
      },
    ]);
  });

  test("applies search limit after dropping malformed video results", async () => {
    const adapter = new YtSearchAdapter(async () => ({
      videos: [
        { url: "https://youtube.test/watch?v=malformed", title: "Malformed" },
        { videoId: "video-1", url: "https://youtube.test/watch?v=video-1", title: "One" },
      ],
    }), noopLogger);

    const results = await adapter.search({ query: "test", options: { limit: 1 } });

    expect(results).toEqual([
      { videoId: "video-1", url: "https://youtube.test/watch?v=video-1", title: "One" },
    ]);
  });

  test("uses managed binary for metadata and download calls", async () => {
    const calls: Array<{ readonly binaryPath: string; readonly url: string; readonly flags: unknown }> = [];
    const binaryManager = {
      getBinaryPath: () => path.join(directory, "youtube-dlp.exe"),
      ensureBinary: async () => path.join(directory, "youtube-dlp.exe"),
    };
    const adapter = new YoutubeDlExecAdapter(
      binaryManager,
      (binaryPath) => async (url, flags) => {
        calls.push({ binaryPath, url, flags });
        return { id: "video-1", title: "Video" };
      },
      noopLogger,
      { ensureFfmpeg: async () => path.join(directory, "bin") },
      { getJsRuntime: () => "bun:/runtime/bun" },
    );

    const metadata = await adapter.getMetadata({ url: "https://youtube.test/watch?v=video-1" });
    const download = await adapter.downloadVideo({
      url: "https://youtube.test/watch?v=video-1",
      outputPath: path.join(directory, "video.%(ext)s"),
      flags: { format: "best" },
    });

    expect(metadata).toEqual({ id: "video-1", title: "Video" });
    expect(download.outputPath).toBe(path.join(directory, "video.%(ext)s"));
    expect(calls).toEqual([
      {
        binaryPath: path.join(directory, "youtube-dlp.exe"),
        url: "https://youtube.test/watch?v=video-1",
        flags: { jsRuntimes: "bun:/runtime/bun", dumpSingleJson: true, skipDownload: true, noWarnings: true },
      },
      {
        binaryPath: path.join(directory, "youtube-dlp.exe"),
        url: "https://youtube.test/watch?v=video-1",
        flags: { format: "best", jsRuntimes: "bun:/runtime/bun", ffmpegLocation: path.join(directory, "bin"), output: path.join(directory, "video.%(ext)s") },
      },
    ]);
  });

  test("does not override consumer jsRuntimes", async () => {
    const calls: Array<{ readonly flags: unknown }> = [];
    const binaryManager = {
      getBinaryPath: () => path.join(directory, "youtube-dlp.exe"),
      ensureBinary: async () => path.join(directory, "youtube-dlp.exe"),
    };
    const adapter = new YoutubeDlExecAdapter(
      binaryManager,
      () => async (_url, flags) => {
        calls.push({ flags });
        return { id: "video-1" };
      },
      noopLogger,
      undefined,
      { getJsRuntime: () => "bun:/runtime/bun" },
    );

    await adapter.getMetadata({
      url: "https://youtube.test/watch?v=video-1",
      flags: { jsRuntimes: "deno:/runtime/deno" },
    });

    expect(calls).toEqual([
      { flags: { jsRuntimes: "deno:/runtime/deno", dumpSingleJson: true, skipDownload: true, noWarnings: true } },
    ]);
  });

  test("formats Bun runtime path for yt-dlp", () => {
    const provider = new BunJsRuntimeProvider({ runtimePath: path.join(directory, "bun.exe") });

    expect(provider.getJsRuntime()).toBe(`bun:${path.resolve(directory, "bun.exe")}`);
  });

  test("does not override consumer ffmpegLocation", async () => {
    let ensureFfmpegCalls = 0;
    const calls: Array<{ readonly flags: unknown }> = [];
    const binaryManager = {
      getBinaryPath: () => path.join(directory, "youtube-dlp.exe"),
      ensureBinary: async () => path.join(directory, "youtube-dlp.exe"),
    };
    const adapter = new YoutubeDlExecAdapter(
      binaryManager,
      () => async (_url, flags) => {
        calls.push({ flags });
        return { id: "video-1" };
      },
      noopLogger,
      {
        async ensureFfmpeg() {
          ensureFfmpegCalls += 1;
          return path.join(directory, "bin");
        },
      },
      { getJsRuntime: () => "bun:/runtime/bun" },
    );

    await adapter.downloadVideo({
      url: "https://youtube.test/watch?v=video-1",
      outputPath: path.join(directory, "video.%(ext)s"),
      flags: { ffmpegLocation: "custom-ffmpeg" },
    });

    expect(calls).toEqual([
      { flags: { ffmpegLocation: "custom-ffmpeg", jsRuntimes: "bun:/runtime/bun", output: path.join(directory, "video.%(ext)s") } },
    ]);
    expect(ensureFfmpegCalls).toBe(0);
  });

  test("service delegates low-level surfaces without adding policy", async () => {
    const seenSearchInputs: YoutubeSearchInput[] = [];
    const searchPort: YoutubeSearchPort = {
      async search(input) {
        seenSearchInputs.push(input);
        return [{ videoId: "video-1", url: "https://youtube.test/watch?v=video-1", title: "Video" }];
      },
    };
    const downloadPort: YoutubeDownloadPort = {
      async getMetadata(input) {
        return { url: input.url };
      },
      async downloadVideo(input) {
        return { outputPath: input.outputPath, result: "ok" };
      },
    };
    const service = new YoutubeService(searchPort, downloadPort);

    const search = await service.search({ query: "video", options: { limit: 5 } });
    const metadata = await service.getMetadata({ url: "https://youtube.test/watch?v=video-1" });
    const download = await service.downloadVideo({
      url: "https://youtube.test/watch?v=video-1",
      outputPath: "consumer-path/%(title)s.%(ext)s",
    });

    expect(search).toHaveLength(1);
    expect(metadata).toEqual({ url: "https://youtube.test/watch?v=video-1" });
    expect(download.outputPath).toBe("consumer-path/%(title)s.%(ext)s");
    expect(seenSearchInputs).toEqual([{ query: "video", options: { limit: 5 } }]);
  });

  test("wraps youtube-dl-exec failures in domain download errors", async () => {
    const binaryManager = {
      getBinaryPath: () => path.join(directory, "youtube-dlp.exe"),
      ensureBinary: async () => path.join(directory, "youtube-dlp.exe"),
    };
    const adapter = new YoutubeDlExecAdapter(
      binaryManager,
      () => async () => {
        throw new Error("video unavailable");
      },
      noopLogger,
    );

    await expect(adapter.getMetadata({ url: "https://youtube.test/watch?v=missing" })).rejects.toThrow(YoutubeDownloadError);
  });
});
