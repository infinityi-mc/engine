export interface MinecraftLogPort {
  streamLogs(serverId: string): ReadableStream<Uint8Array>;
}
