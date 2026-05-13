export class InvalidMinecraftPlayerNameError extends Error {
  readonly name = "InvalidMinecraftPlayerNameError";

  constructor(readonly playerName: string) {
    super(`Invalid Minecraft player name: ${playerName}`);
  }
}
