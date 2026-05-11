export class NbtPathNotFoundError extends Error {
  readonly name = "NbtPathNotFoundError";

  constructor(
    readonly filePath: string,
    readonly dotPath: string,
  ) {
    super(`Path not found in NBT: ${dotPath} (file: ${filePath})`);
  }
}
