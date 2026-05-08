export class MinecraftServerNotRunningError extends Error {
  readonly name = "MinecraftServerNotRunningError";

  constructor(readonly serverId: string) {
    super(`Minecraft server is not running: ${serverId}`);
  }
}
