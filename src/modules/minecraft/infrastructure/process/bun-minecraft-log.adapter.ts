import type { BunServerProcessAdapter } from "../../../server/infrastructure/process/bun-server-process.adapter";
import type { LogLineCallback, MinecraftLogPort } from "../../domain/ports/minecraft-log.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";

interface StreamReader {
  read(): Promise<{ done: boolean; value: Uint8Array | undefined }>;
  releaseLock(): void;
}

interface ServerLogState {
  callbacks: Set<LogLineCallback>;
  readerPromise: Promise<void> | null;
  cancelled: boolean;
}

export class BunMinecraftLogAdapter implements MinecraftLogPort {
  private readonly servers = new Map<string, ServerLogState>();

  constructor(
    private readonly serverProcessAdapter: BunServerProcessAdapter,
    private readonly logger: LoggerPort,
  ) {}

  onLogLine(serverId: string, callback: LogLineCallback): () => void {
    const state = this.getOrCreateState(serverId);
    state.callbacks.add(callback);
    this.ensureReader(serverId, state);

    return () => {
      state.callbacks.delete(callback);
      if (state.callbacks.size === 0) {
        state.cancelled = true;
      }
    };
  }

  createSSEStream(serverId: string): ReadableStream<Uint8Array> {
    const state = this.getOrCreateState(serverId);
    this.ensureReader(serverId, state);

    const encoder = new TextEncoder();
    let callback: LogLineCallback | null = null;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        callback = (line: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
          } catch {
            // Controller already closed
          }
        };
        state.callbacks.add(callback);
      },
      cancel: () => {
        if (callback) {
          state.callbacks.delete(callback);
          if (state.callbacks.size === 0) {
            state.cancelled = true;
          }
        }
      },
    });
  }

  private getOrCreateState(serverId: string): ServerLogState {
    let state = this.servers.get(serverId);
    if (state === undefined) {
      state = { callbacks: new Set(), readerPromise: null, cancelled: false };
      this.servers.set(serverId, state);
    }
    return state;
  }

  private ensureReader(serverId: string, state: ServerLogState): void {
    if (state.readerPromise !== null) return;

    state.readerPromise = this.readLoop(serverId, state)
      .catch((error) => {
        this.logger.warn("minecraft.log_adapter.readLoop_error", {
          module: "minecraft",
          operation: "log_adapter.readLoop",
          serverId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        state.readerPromise = null;
        if (state.cancelled) {
          this.servers.delete(serverId);
        }
      });
  }

  private async readLoop(serverId: string, state: ServerLogState): Promise<void> {
    const subprocess = this.serverProcessAdapter.getSubprocess(serverId);
    if (subprocess === undefined) {
      state.cancelled = true;
      return;
    }

    const stdout = subprocess.stdout;
    const stderr = subprocess.stderr;

    if (!isReadableStream(stdout) || !isReadableStream(stderr)) {
      state.cancelled = true;
      return;
    }

    let stdoutReader: StreamReader | undefined = stdout.getReader() as StreamReader;
    let stderrReader: StreamReader | undefined = stderr.getReader() as StreamReader;
    let stdoutDone = false;
    let stderrDone = false;
    let remainder = "";
    const decoder = new TextDecoder();

    try {
      while (!stdoutDone || !stderrDone) {
        if (state.cancelled) break;
        const reads: Promise<{ source: "stdout" | "stderr"; result: { done: boolean; value: Uint8Array | undefined } }>[] = [];

        if (!stdoutDone && stdoutReader) {
          reads.push(stdoutReader.read().then((r) => ({ source: "stdout" as const, result: r })));
        }
        if (!stderrDone && stderrReader) {
          reads.push(stderrReader.read().then((r) => ({ source: "stderr" as const, result: r })));
        }

        if (reads.length === 0) break;

        const { source, result } = await Promise.race(reads);

        if (result.done) {
          if (source === "stdout") {
            stdoutDone = true;
            stdoutReader?.releaseLock();
            stdoutReader = undefined;
          } else {
            stderrDone = true;
            stderrReader?.releaseLock();
            stderrReader = undefined;
          }
          continue;
        }

        if (result.value) {
          const text = remainder + decoder.decode(result.value, { stream: true });
          const lines = text.split("\n");
          remainder = lines.pop() ?? "";

          for (const line of lines) {
            if (line.length > 0) {
              this.dispatch(state, line);
            }
          }
        }
      }

      // Flush remaining text
      if (remainder.length > 0) {
        this.dispatch(state, remainder);
      }
    } finally {
      stdoutReader?.releaseLock();
      stderrReader?.releaseLock();
    }
  }

  private dispatch(state: ServerLogState, line: string): void {
    for (const callback of state.callbacks) {
      try {
        callback(line);
      } catch (error) {
        this.logger.debug("minecraft.log_adapter.callback_error", {
          module: "minecraft",
          operation: "log_adapter.dispatch",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return value instanceof ReadableStream;
}
