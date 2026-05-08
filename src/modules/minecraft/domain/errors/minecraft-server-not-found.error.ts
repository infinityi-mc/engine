export class MinecraftServerNotFoundError extends Error {
  readonly name = "MinecraftServerNotFoundError";

  constructor(readonly serverId: string) {
    super(`Minecraft server not found: ${serverId}`);
  }
}
