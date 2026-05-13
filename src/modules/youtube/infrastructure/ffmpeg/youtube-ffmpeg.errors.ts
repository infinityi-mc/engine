export class YoutubeFfmpegError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "YoutubeFfmpegError";
    this.cause = options?.cause;
  }
}

export class YoutubeFfmpegUnsupportedPlatformError extends YoutubeFfmpegError {
  constructor(platform: string, arch: string) {
    super(`Unsupported ffmpeg platform: ${platform}/${arch}`);
    this.name = "YoutubeFfmpegUnsupportedPlatformError";
  }
}
