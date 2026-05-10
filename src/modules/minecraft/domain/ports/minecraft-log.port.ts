export type LogLineCallback = (line: string) => void;

export interface MinecraftLogPort {
  /** Subscribe to live log lines. Returns an unsubscribe function. */
  onLogLine(serverId: string, callback: LogLineCallback): () => void;

  /** Create a per-client SSE stream for the given server. */
  createSSEStream(serverId: string): ReadableStream<Uint8Array>;
}
