export interface YoutubeBinaryPort {
  getBinaryPath(): string;
  ensureBinary(): Promise<string>;
}
