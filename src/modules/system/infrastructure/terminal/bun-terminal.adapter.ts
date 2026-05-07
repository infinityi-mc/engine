import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { noopLogger } from "../../../../shared/observability/logger.port";
import { getErrorMessage, getErrorName } from "../../../../shared/observability/error-utils";
import type { TerminalOptions, TerminalPort, TerminalResult } from "../../domain/ports/terminal.port";

export class BunTerminalAdapter implements TerminalPort {
  constructor(private readonly logger: LoggerPort = noopLogger) {}

  async execute(options: TerminalOptions): Promise<TerminalResult> {
    const args = options.args ?? [];
    const commandArgs = options.shell ? buildShellCommand(options.command, args) : [options.command, ...args];
    const startedAt = performance.now();
    const abortController = new AbortController();
    const timeout = options.timeoutMs
      ? setTimeout(() => abortController.abort(), options.timeoutMs)
      : undefined;

    try {
      const spawnOptions = {
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.env !== undefined ? { env: { ...getEnvironment(), ...options.env } } : {}),
        stdin: options.input !== undefined ? "pipe" as const : "ignore" as const,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
        signal: abortController.signal,
      };
      const subprocess = Bun.spawn(commandArgs, {
        ...spawnOptions,
      });

      if (options.input !== undefined && subprocess.stdin) {
        subprocess.stdin.write(options.input);
        subprocess.stdin.end();
      }

      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]);
      const durationMs = Math.round(performance.now() - startedAt);

      this.logCompletion(exitCode === 0 ? "info" : "warn", "system.terminal.executed", {
        command: options.command,
        argsCount: args.length,
        cwd: options.cwd,
        shell: options.shell ?? false,
        hasInput: options.input !== undefined,
        exitCode,
        durationMs,
      });

      return {
        command: options.command,
        args,
        exitCode,
        stdout,
        stderr,
        durationMs,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);

      if (abortController.signal.aborted) {
        this.logger.warn("system.terminal.timeout", {
          module: "system",
          operation: "terminal.execute",
          command: options.command,
          argsCount: args.length,
          cwd: options.cwd,
          shell: options.shell ?? false,
          hasInput: options.input !== undefined,
          timeoutMs: options.timeoutMs,
          durationMs,
        });

        throw new Error(`Command timed out after ${options.timeoutMs}ms`);
      }

      this.logger.error("system.terminal.error", {
        module: "system",
        operation: "terminal.execute",
        command: options.command,
        argsCount: args.length,
        cwd: options.cwd,
        shell: options.shell ?? false,
        hasInput: options.input !== undefined,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
        durationMs,
      });

      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private logCompletion(level: "info" | "warn", message: string, context: Record<string, unknown>): void {
    this.logger[level](message, {
      module: "system",
      operation: "terminal.execute",
      ...context,
    });
  }
}

function buildShellCommand(command: string, args: string[]): string[] {
  const commandLine = [command, ...args.map(quoteShellArg)].join(" ");

  if (process.platform === "win32") {
    return ["cmd.exe", "/d", "/s", "/c", commandLine];
  }

  return ["/bin/sh", "-lc", commandLine];
}

function quoteShellArg(arg: string): string {
  if (process.platform === "win32") {
    return `"${arg.replaceAll('"', '\\"')}"`;
  }

  return `'${arg.replaceAll("'", "'\\''")}'`;
}

function getEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
