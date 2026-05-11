export class NbtFileNotFoundError extends Error {
  readonly name = "NbtFileNotFoundError";

  constructor(readonly filePath: string) {
    super(`NBT file not found: ${filePath}`);
  }
}
