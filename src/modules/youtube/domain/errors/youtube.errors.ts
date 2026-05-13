export class YoutubeDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "YoutubeDownloadError";
    this.cause = options?.cause;
  }
}
