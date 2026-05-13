# YouTube Module

## Purpose

Provides low-level YouTube search, metadata fetching, download execution, and managed `youtube-dlp` binary access for consumer modules.

## Domain Model

types:
  `YoutubeSearchInput`       `domain/types/youtube.types.ts`
  `YoutubeSearchVideo`       `domain/types/youtube.types.ts`
  `YoutubeMetadataInput`     `domain/types/youtube.types.ts`
  `YoutubeDownloadInput`     `domain/types/youtube.types.ts`
  `YoutubeDownloadResult`    `domain/types/youtube.types.ts`
  `YoutubeVideoMetadata`     `domain/types/youtube.types.ts`

errors:
  `YoutubeDownloadError`     `domain/errors/youtube.errors.ts`

## Ports

inbound:
  `YoutubeService`       `application/youtube.service.ts`

outbound:
  `YoutubeSearchPort`      `domain/ports/youtube-search.port.ts`
  adapters:
    `YtSearchAdapter`      `infrastructure/search/yt-search.adapter.ts`
  `YoutubeDownloadPort`    `domain/ports/youtube-download.port.ts`
  adapters:
    `YoutubeDlExecAdapter` `infrastructure/download/youtube-dl-exec.adapter.ts`

## Application

`YoutubeService` exposes:

- `search(input)` via `yt-search`; consumers choose limits and downstream filtering.
- `getMetadata(input)` via `youtube-dl-exec` with `dumpSingleJson`, `skipDownload`, and lazy binary ensure.
- `downloadVideo(input)` via `youtube-dl-exec`; consumers provide output path and any yt-dlp flags.

## Binary Rules

- Managed binary directory is `bin/` from `src/bootstrap/container.ts`.
- Windows binary path: `bin/youtube-dlp.exe`, downloaded from yt-dlp latest `yt-dlp.exe` release asset.
- Linux binary path: `bin/youtube-dlp`, downloaded from yt-dlp latest `yt-dlp_linux` release asset.
- Binary download is lazy: metadata/download ensure the binary exists; search does not.
- Linux binary permissions are set to `755` after download.
- Binary management is infrastructure-internal: `infrastructure/binary/youtube-binary.port.ts`.
- Managed ffmpeg/ffprobe directory is `bin/`; `downloadVideo` injects `ffmpegLocation` unless consumer flags already provide it.
- Windows ffmpeg source: BtbN latest `ffmpeg-master-latest-win64-lgpl.zip`; installs `bin/ffmpeg.exe` and `bin/ffprobe.exe`.
- Linux ffmpeg source: BtbN latest `ffmpeg-master-latest-linux64-lgpl.tar.xz`; installs `bin/ffmpeg` and `bin/ffprobe`.
- JS runtime provider is infrastructure-internal: `infrastructure/js-runtime/bun-js-runtime.provider.ts`.
- Metadata/download inject `jsRuntimes: bun:<process.execPath>` unless consumer flags already provide `jsRuntimes`.

## Integration Rules

- Registered in `src/bootstrap/container.ts` as `youtubeService`.
- No HTTP routes or agent tools are registered by this module.
- Persistence, output path selection, size limits, and policy enforcement belong to consumer modules.

## Dependencies

consumes:
  `LoggerPort`    `../../shared/observability/logger.port.ts`

## Tests

`../../../test/youtube/youtube-module.test.ts`
