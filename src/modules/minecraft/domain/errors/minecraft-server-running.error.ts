export class MinecraftServerRunningError extends Error {
  readonly name = "MinecraftServerRunningError";

  constructor(readonly serverId: string) {
    super(`Cannot modify spawn config of a running Minecraft server: ${serverId}. Stop it first.`);
  }
}
