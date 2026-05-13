# Audioplayer Module

## Purpose

Owns downloaded music persistence, YouTube-backed audio downloads, and Minecraft `audioplayer` mod playback orchestration.

## Domain Model

types:
  `AudioTrack`            `domain/types/audio-track.ts`
  `ListAudioTracksInput`  `domain/types/audio-track.ts`

errors:
  `AudioPlayerFeatureDisabledError`  `domain/errors/audio-player.errors.ts`
  `AudioTrackNotFoundError`          `domain/errors/audio-player.errors.ts`
  `AudioTrackWorldMismatchError`     `domain/errors/audio-player.errors.ts`
  `AudioTrackAlreadyPlayingError`    `domain/errors/audio-player.errors.ts`
  `AudioDownloadTooLargeError`       `domain/errors/audio-player.errors.ts`

## Ports

inbound:
  `AudioPlayerService`    `application/audio-player.service.ts`

outbound:
  `AudioTrackRepositoryPort`  `domain/ports/audio-track-repository.port.ts`
  adapters:
    `JsonAudioTrackRepositoryAdapter`  `infrastructure/persistence/json-audio-track-repository.adapter.ts`

## HTTP Routes

routes: `infrastructure/http/audioplayer-routes.ts`
scopes: `infrastructure/http/scopes.ts`

- `GET /audioplayer/search` requires `audioplayer:read`.
- `POST /audioplayer/tracks` requires `audioplayer:write`; server generates UUID track IDs.
- `GET /audioplayer/servers/:serverId/tracks` requires `audioplayer:read`.
- `POST /audioplayer/servers/:serverId/tracks/:trackId/play` requires `audioplayer:write`.
- `POST /audioplayer/servers/:serverId/tracks/:trackId/stop` requires `audioplayer:write`.
- `DELETE /audioplayer/servers/:serverId/tracks/:trackId` requires `audioplayer:write`.

## Runtime Rules

- Server definitions must opt in with `features.audioPlayer.enabled === true`.
- Track store path is `DATA_DIR/audioplayer/tracks.json`, keyed by UUID.
- Download output path is `<server.directory>/<worldName>/audioplayer/<uuid>.<downloadFormat>`.
- `audioPlayer` config defaults: `maxDownloadSize=15MiB`, `downloadFormat=mp3`, `maxPlayerRequest=20`, `playbackRange=32`.
- Play checks server running state, track existence, world match, and online player before sending the play command.
- One track may play per server; new playback stops existing playing tracks for that server.
- Delete is blocked while `isPlaying` is true.

## Dependencies

consumes:
  `youtube` module `YoutubeService`
  `minecraft` module repository, stdin, metadata, player-data ports
  `server` module registry port
  `ConfigPort`      `../../shared/config/config.port.ts`
  `LoggerPort`      `../../shared/observability/logger.port.ts`

consumed-by:
  `agent` module tools in `../agent/infrastructure/tools/audioplayer-tools.ts`

## Tests

`../../../test/audioplayer/audio-player.service.test.ts`
