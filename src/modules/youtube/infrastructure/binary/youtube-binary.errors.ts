export class YoutubeBinaryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "YoutubeBinaryError";
    this.cause = options?.cause;
  }
}

export class YoutubeUnsupportedPlatformError extends YoutubeBinaryError {
  constructor(platform: string) {
    super(`Unsupported youtube-dlp platform: ${platform}`);
    this.name = "YoutubeUnsupportedPlatformError";
  }
}
