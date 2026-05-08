export class MinecraftServerAlreadyExistsError extends Error {
  readonly name = "MinecraftServerAlreadyExistsError";

  constructor(readonly serverId: string) {
    super(`Minecraft server already exists: ${serverId}`);
  }
}
