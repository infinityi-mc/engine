export class MinecraftPlayerOfflineError extends Error {
  readonly name = "MinecraftPlayerOfflineError";

  constructor(readonly serverId: string, readonly playerName: string) {
    super(`Minecraft player is offline or not found: ${playerName} on ${serverId}`);
  }
}
