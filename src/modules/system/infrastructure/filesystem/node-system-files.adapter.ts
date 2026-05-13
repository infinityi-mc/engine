import { createReadStream } from "node:fs";
import { cp, copyFile, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import nodePath from "node:path";
import { createInterface } from "node:readline/promises";
import { getErrorMessage, getErrorName } from "../../../../shared/observability/error-utils";
import type { LoggerPort, LogLevel } from "../../../../shared/observability/logger.port";
import { noopLogger } from "../../../../shared/observability/logger.port";
import { validateRegexPattern } from "../../../../shared/validation/regex-safety";
import { ClientInputError } from "../../domain/errors/client-input.error";
import { UnsupportedToolError } from "../../domain/errors/unsupported-tool.error";
import type {
  AwkInput,
  FileEntry,
  FileReadResult,
  FilesystemPort,
  GlobInput,
  GrepInput,
  GrepMatch,
  ReadFileInput,
  SedInput,
} from "../../domain/ports/filesystem.port";
import type { TerminalPort, TerminalResult } from "../../domain/ports/terminal.port";

const defaultMaxGlobResults = 10_000;
const defaultMaxGrepFiles = 10_000;
const defaultMaxGrepDepth = 64;
type ToolInput = AwkInput | SedInput;

export class NodeSystemFilesAdapter implements FilesystemPort {
  constructor(
    private readonly terminal: TerminalPort,
    private readonly logger: LoggerPort = noopLogger,
  ) {}

  async glob(input: GlobInput): Promise<string[]> {
    const startedAt = performance.now();

    try {
      const glob = new Bun.Glob(input.pattern);
      const matches: string[] = [];
      const maxResults = input.maxResults ?? defaultMaxGlobResults;

      for await (const filePath of glob.scan({ cwd: input.cwd ?? "." })) {
        if (matches.length >= maxResults) {
          break;
        }

        matches.push(filePath);
      }

      this.logger.debug("system.filesystem.glob", {
        module: "system",
        operation: "filesystem.glob",
        success: true,
        pattern: input.pattern,
        cwd: input.cwd,
        maxResults,
        matchCount: matches.length,
        durationMs: getDurationMs(startedAt),
      });

      return matches;
    } catch (error) {
      this.logFailure("warn", "system.filesystem.glob", "filesystem.glob", startedAt, error, {
        pattern: input.pattern,
        cwd: input.cwd,
        maxResults: input.maxResults,
      });
      throw error;
    }
  }

  async grep(input: GrepInput): Promise<GrepMatch[]> {
    const startedAt = performance.now();

    try {
      const files = await this.resolveGrepFiles(input.path ?? ".", input.include);
      const regex = this.createGrepRegex(input.pattern, input.caseSensitive);
      const maxResults = input.maxResults ?? Number.POSITIVE_INFINITY;
      const matches = await this.grepInFiles(files, regex, maxResults);

      this.logger.debug("system.filesystem.grep", {
        module: "system",
        operation: "filesystem.grep",
        success: true,
        path: input.path,
        include: input.include,
        caseSensitive: input.caseSensitive ?? true,
        maxResults: input.maxResults,
        matchCount: matches.length,
        durationMs: getDurationMs(startedAt),
      });

      return matches;
    } catch (error) {
      this.logFailure(
        error instanceof ClientInputError ? "warn" : "error",
        "system.filesystem.grep",
        "filesystem.grep",
        startedAt,
        error,
        {
          path: input.path,
          include: input.include,
          caseSensitive: input.caseSensitive ?? true,
          maxResults: input.maxResults,
        },
      );
      throw error;
    }
  }

  private createGrepRegex(pattern: string, caseSensitive?: boolean): RegExp {
    const regexError = validateRegexPattern(pattern);
    if (regexError !== undefined) {
      throw new ClientInputError(regexError);
    }
    const flags = caseSensitive === false ? "gi" : "g";
    return createSafeRegex(pattern, flags);
  }

  private async grepInFiles(files: string[], regex: RegExp, maxResults: number): Promise<GrepMatch[]> {
    const matches: GrepMatch[] = [];

    for (const filePath of files) {
      if (matches.length >= maxResults) {
        break;
      }

      const fileMatches = await grepFile(filePath, regex, maxResults - matches.length, this.logger);
      matches.push(...fileMatches);
    }

    return matches;
  }

  async listDir(directoryPath: string): Promise<FileEntry[]> {
    const startedAt = performance.now();

    try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      const result = entries.map((entry) => ({
        name: entry.name,
        path: nodePath.join(directoryPath, entry.name),
        type: getFileEntryType(entry),
      }));

      this.logger.debug("system.filesystem.listDir", {
        module: "system",
        operation: "filesystem.listDir",
        success: true,
        path: directoryPath,
        entryCount: result.length,
        durationMs: getDurationMs(startedAt),
      });

      return result;
    } catch (error) {
      this.logFailure("warn", "system.filesystem.listDir", "filesystem.listDir", startedAt, error, {
        path: directoryPath,
      });
      throw error;
    }
  }

  async readFile(input: ReadFileInput): Promise<FileReadResult> {
    const startedAt = performance.now();

    try {
      const fileStat = await stat(input.path);
      const content = await readFile(input.path, input.encoding ?? "utf8");
      const result = {
        path: input.path,
        content,
        sizeBytes: fileStat.size,
      };

      this.logger.debug("system.filesystem.readFile", {
        module: "system",
        operation: "filesystem.readFile",
        success: true,
        path: input.path,
        sizeBytes: fileStat.size,
        durationMs: getDurationMs(startedAt),
      });

      return result;
    } catch (error) {
      this.logFailure("warn", "system.filesystem.readFile", "filesystem.readFile", startedAt, error, {
        path: input.path,
      });
      throw error;
    }
  }

  async awk(input: AwkInput): Promise<TerminalResult> {
    return this.runTool("awk", input, input.program);
  }

  async move(source: string, destination: string): Promise<void> {
    const startedAt = performance.now();

    try {
      await rename(source, destination);
    } catch (error) {
      if (!isCrossDeviceError(error)) {
        this.logFailure("warn", "system.filesystem.move", "filesystem.move", startedAt, error, {
          source,
          destination,
        });
        throw error;
      }

      await this.moveFallback(source, destination, startedAt);
      return;
    }

    this.logger.info("system.filesystem.move", {
      module: "system",
      operation: "filesystem.move",
      success: true,
      source,
      destination,
      durationMs: getDurationMs(startedAt),
    });
  }

  private async moveFallback(source: string, destination: string, startedAt: number): Promise<void> {
    try {
      await this.copy(source, destination);
      await this.delete(source, true);
    } catch (fallbackError) {
      await this.cleanupFailedMove(source, destination, startedAt, fallbackError);
      throw fallbackError;
    }
  }

  private async cleanupFailedMove(
    source: string,
    destination: string,
    startedAt: number,
    fallbackError: unknown,
  ): Promise<void> {
    try {
      await rm(destination, { recursive: true, force: true });
    } catch (cleanupError) {
      this.logFailure("warn", "system.filesystem.move.cleanup", "filesystem.move", startedAt, cleanupError, {
        source,
        destination,
        fallback: "copy-delete",
      });

      throw new AggregateError([fallbackError, cleanupError], "Move fallback failed and destination cleanup failed");
    }

    this.logFailure("warn", "system.filesystem.move", "filesystem.move", startedAt, fallbackError, {
      source,
      destination,
      fallback: "copy-delete",
    });
  }

  async copy(source: string, destination: string): Promise<void> {
    const startedAt = performance.now();

    try {
      const sourceStat = await stat(source);

      if (sourceStat.isDirectory()) {
        await cp(source, destination, { recursive: true, force: true });
      } else {
        await copyFile(source, destination);
      }

      this.logger.info("system.filesystem.copy", {
        module: "system",
        operation: "filesystem.copy",
        success: true,
        source,
        destination,
        sourceType: sourceStat.isDirectory() ? "directory" : "file",
        durationMs: getDurationMs(startedAt),
      });
    } catch (error) {
      this.logFailure("warn", "system.filesystem.copy", "filesystem.copy", startedAt, error, {
        source,
        destination,
      });
      throw error;
    }
  }

  async delete(targetPath: string, recursive = false): Promise<void> {
    const startedAt = performance.now();

    try {
      await rm(targetPath, { recursive, force: false });

      this.logger.info("system.filesystem.delete", {
        module: "system",
        operation: "filesystem.delete",
        success: true,
        path: targetPath,
        recursive,
        durationMs: getDurationMs(startedAt),
      });
    } catch (error) {
      this.logFailure("warn", "system.filesystem.delete", "filesystem.delete", startedAt, error, {
        path: targetPath,
        recursive,
      });
      throw error;
    }
  }

  async sed(input: SedInput): Promise<TerminalResult> {
    return this.runTool("sed", input, input.script);
  }

  private async resolveGrepFiles(rootPath: string, include?: string): Promise<string[]> {
    const rootStat = await stat(rootPath);

    if (rootStat.isFile()) {
      return [rootPath];
    }

    if (!rootStat.isDirectory()) {
      return [];
    }

    if (include) {
      const paths: string[] = [];
      const glob = new Bun.Glob(include);

      for await (const relativePath of glob.scan({ cwd: rootPath, onlyFiles: true })) {
        if (paths.length >= defaultMaxGrepFiles) {
          break;
        }

        paths.push(nodePath.join(rootPath, relativePath));
      }

      return paths;
    }

    return collectFiles(rootPath, 0, defaultMaxGrepDepth, defaultMaxGrepFiles);
  }

  private async runTool(tool: "awk" | "sed", input: ToolInput, programOrScript: string): Promise<TerminalResult> {
    const startedAt = performance.now();
    const operation = `filesystem.${tool}`;

    try {
      await this.ensureToolAvailable(tool);

      const result = await this.terminal.execute({
        command: tool,
        args: [...(input.args ?? []), programOrScript, ...(input.files ?? [])],
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });

      const success = result.exitCode === 0;
      this.logger[success ? "info" : "warn"](`system.${operation}`, {
        module: "system",
        operation,
        success,
        tool,
        cwd: input.cwd,
        filesCount: input.files?.length ?? 0,
        hasInput: input.input !== undefined,
        argsCount: input.args?.length ?? 0,
        exitCode: result.exitCode,
        durationMs: getDurationMs(startedAt),
      });

      return result;
    } catch (error) {
      this.logFailure(
        error instanceof UnsupportedToolError ? "warn" : "error",
        `system.${operation}`,
        operation,
        startedAt,
        error,
        {
          tool,
          cwd: input.cwd,
          filesCount: input.files?.length ?? 0,
          hasInput: input.input !== undefined,
          argsCount: input.args?.length ?? 0,
        },
      );
      throw error;
    }
  }

  private async ensureToolAvailable(tool: "awk" | "sed"): Promise<void> {
    const result = process.platform === "win32"
      ? await this.terminal.execute({ command: "where.exe", args: [tool] })
      : await this.terminal.execute({ command: "/bin/sh", args: ["-lc", `command -v ${tool}`] });

    if (result.exitCode !== 0) {
      throw new UnsupportedToolError(tool);
    }
  }

  private logFailure(
    level: Exclude<LogLevel, "debug" | "info">,
    message: string,
    operation: string,
    startedAt: number,
    error: unknown,
    context: Record<string, unknown> = {},
  ): void {
    this.logger[level](message, {
      module: "system",
      operation,
      success: false,
      ...context,
      errorName: getErrorName(error),
      errorMessage: getErrorMessage(error),
      durationMs: getDurationMs(startedAt),
    });
  }
}

async function collectFiles(
  directoryPath: string,
  depth: number,
  maxDepth: number,
  maxFiles: number,
): Promise<string[]> {
  if (depth > maxDepth) return [];

  const files: string[] = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (files.length >= maxFiles) break;

    const entryPath = nodePath.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await collectFiles(entryPath, depth + 1, maxDepth, maxFiles - files.length);
      files.push(...nestedFiles);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function grepFile(
  filePath: string,
  regex: RegExp,
  maxResults: number,
  logger: LoggerPort,
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  try {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const text of lines) {
      lineNumber += 1;
      regex.lastIndex = 0;

      for (const match of text.matchAll(regex)) {
        if (match.index === undefined) {
          continue;
        }

        matches.push({
          path: filePath,
          lineNumber,
          column: match.index + 1,
          text,
        });

        if (matches.length >= maxResults) {
          lines.close();
          return matches;
        }
      }
    }
  } catch (error) {
    logger.debug("system.filesystem.grep.skipFile", {
      module: "system",
      operation: "filesystem.grep",
      path: filePath,
      errorName: getErrorName(error),
      errorMessage: getErrorMessage(error),
    });

    return [];
  }

  return matches;
}

function createSafeRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new ClientInputError(getErrorMessage(error));
  }
}

function getFileEntryType(entry: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): FileEntry["type"] {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

function isCrossDeviceError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === "EXDEV";
}

function getDurationMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
