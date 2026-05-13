export class AudioPlayerFeatureDisabledError extends Error {
  readonly name = "AudioPlayerFeatureDisabledError";

  constructor(readonly serverId: string) {
    super(`Audio player feature is not enabled for server "${serverId}".`);
  }
}

export class AudioTrackNotFoundError extends Error {
  readonly name = "AudioTrackNotFoundError";

  constructor(readonly trackId: string) {
    super(`Audio track "${trackId}" was not found.`);
  }
}

export class AudioTrackWorldMismatchError extends Error {
  readonly name = "AudioTrackWorldMismatchError";

  constructor(
    readonly trackId: string,
    readonly trackWorldName: string,
    readonly serverWorldName: string,
  ) {
    super(`Audio track "${trackId}" belongs to world "${trackWorldName}", but the server is running world "${serverWorldName}".`);
  }
}

export class AudioTrackAlreadyPlayingError extends Error {
  readonly name = "AudioTrackAlreadyPlayingError";

  constructor(readonly trackId: string) {
    super(`Audio track "${trackId}" is currently playing and cannot be deleted.`);
  }
}

export class AudioDownloadTooLargeError extends Error {
  readonly name = "AudioDownloadTooLargeError";

  constructor(readonly size: number, readonly maxSize: number) {
    super(`Downloaded audio is ${size} bytes, exceeding the configured limit of ${maxSize} bytes.`);
  }
}

export class AudioPlayerRequestLimitError extends Error {
  readonly name = "AudioPlayerRequestLimitError";

  constructor(readonly playerName: string, readonly maxRequests: number) {
    super(`Player "${playerName}" has reached the audio track request limit of ${maxRequests}.`);
  }
}
