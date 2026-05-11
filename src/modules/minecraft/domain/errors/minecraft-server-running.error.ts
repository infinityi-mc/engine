export class MinecraftServerRunningError extends Error {
  readonly name = "MinecraftServerRunningError";

  constructor(readonly serverId: string) {
    super(`Cannot modify a running Minecraft server: ${serverId}. Stop it first.`);
  }
}
