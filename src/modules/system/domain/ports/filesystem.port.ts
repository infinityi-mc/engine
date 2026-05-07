import type { TerminalResult } from "./terminal.port";

export interface FileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory" | "symlink" | "other";
}

export interface GrepMatch {
  readonly path: string;
  readonly lineNumber: number;
  readonly column: number;
  readonly text: string;
}

export interface GlobInput {
  readonly pattern: string;
  readonly cwd?: string;
  readonly maxResults?: number;
}

export interface GrepInput {
  readonly pattern: string;
  readonly path?: string;
  readonly include?: string;
  readonly caseSensitive?: boolean;
  readonly maxResults?: number;
}

export interface ReadFileInput {
  readonly path: string;
  readonly encoding?: BufferEncoding;
}

export interface FileReadResult {
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
}

export interface AwkInput {
  readonly program: string;
  readonly files?: string[];
  readonly input?: string;
  readonly cwd?: string;
  readonly args?: string[];
  readonly timeoutMs?: number;
}

export interface SedInput {
  readonly script: string;
  readonly files?: string[];
  readonly input?: string;
  readonly cwd?: string;
  readonly args?: string[];
  readonly timeoutMs?: number;
}

export interface FilesystemPort {
  glob(input: GlobInput): Promise<string[]>;
  grep(input: GrepInput): Promise<GrepMatch[]>;
  listDir(path: string): Promise<FileEntry[]>;
  readFile(input: ReadFileInput): Promise<FileReadResult>;
  awk(input: AwkInput): Promise<TerminalResult>;
  move(source: string, destination: string): Promise<void>;
  copy(source: string, destination: string): Promise<void>;
  delete(path: string, recursive?: boolean): Promise<void>;
  sed(input: SedInput): Promise<TerminalResult>;
}
