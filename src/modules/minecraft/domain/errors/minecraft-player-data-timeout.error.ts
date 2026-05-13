export class MinecraftPlayerDataTimeoutError extends Error {
  readonly name = "MinecraftPlayerDataTimeoutError";

  constructor(readonly serverId: string, readonly playerName: string, readonly timeoutMs: number) {
    super(`Timed out waiting for player data: ${playerName} on ${serverId} after ${timeoutMs}ms`);
  }
}
