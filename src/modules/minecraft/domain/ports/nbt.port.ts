export interface NbtValue {
  readonly type: string;
  readonly value: unknown;
}

export interface NbtKeyInfo {
  readonly key: string;
  readonly type: string;
}

export interface NbtStructureEntry {
  readonly path: string;
  readonly type: string;
}

export interface NbtPort {
  read(filePath: string, depth: number): Promise<NbtValue>;
  get(filePath: string, dotPath: string): Promise<NbtValue>;
  search(filePath: string, pattern: string, limit: number): Promise<string[]>;
  keys(filePath: string, dotPath: string | undefined): Promise<NbtKeyInfo[]>;
  structure(filePath: string, depth: number): Promise<NbtStructureEntry[]>;
}
