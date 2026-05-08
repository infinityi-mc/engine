import type { BunServerProcessAdapter } from "../../../server/infrastructure/process/bun-server-process.adapter";
import type { MinecraftLogPort } from "../../domain/ports/minecraft-log.port";

// Minimal read contract for a ReadableStream reader.
// Cannot use ReadableStreamDefaultReader<Uint8Array> directly because
// Bun's type adds readMany() which Node's type lacks, causing TS2741.
interface StreamReader {
  read(): Promise<{ done: boolean; value: Uint8Array | undefined }>;
  releaseLock(): void;
}

export class BunMinecraftLogAdapter implements MinecraftLogPort {
  constructor(
    private readonly serverProcessAdapter: BunServerProcessAdapter,
  ) {}

  streamLogs(serverId: string): ReadableStream<Uint8Array> {
    const subprocess = this.serverProcessAdapter.getSubprocess(serverId);
    if (subprocess === undefined) {
      return new ReadableStream({
        start(controller) {
          controller.error(new Error(`Minecraft server is not running: ${serverId}`));
        },
      });
    }

    const stdout = subprocess.stdout;
    const stderr = subprocess.stderr;

    if (!isReadableStream(stdout) || !isReadableStream(stderr)) {
      return new ReadableStream({
        start(controller) {
          controller.error(new Error(`Minecraft server streams not available: ${serverId}`));
        },
      });
    }

    // Acquire readers once in start(), drain both fully before closing
    let stdoutReader: StreamReader | undefined;
    let stderrReader: StreamReader | undefined;
    let stdoutDone = false;
    let stderrDone = false;

    return new ReadableStream<Uint8Array>({
      start() {
        stdoutReader = stdout.getReader() as StreamReader;
        stderrReader = stderr.getReader() as StreamReader;
      },

      async pull(controller) {
        // Build list of still-active readers
        const reads: Promise<{ source: "stdout" | "stderr"; result: { done: boolean; value: Uint8Array | undefined } }>[] = [];

        if (!stdoutDone && stdoutReader) {
          reads.push(stdoutReader.read().then((result) => ({ source: "stdout" as const, result })));
        }
        if (!stderrDone && stderrReader) {
          reads.push(stderrReader.read().then((result) => ({ source: "stderr" as const, result })));
        }

        // Both streams ended — close
        if (reads.length === 0) {
          controller.close();
          return;
        }

        // Wait for the first available chunk from any stream
        const { source, result } = await Promise.race(reads);

        if (result.done) {
          // Mark this stream as done, release its reader
          if (source === "stdout") {
            stdoutDone = true;
            stdoutReader?.releaseLock();
            stdoutReader = undefined;
          } else {
            stderrDone = true;
            stderrReader?.releaseLock();
            stderrReader = undefined;
          }

          // If both done, close; otherwise pull() will be called again for remaining stream
          if (stdoutDone && stderrDone) {
            controller.close();
          }
          return;
        }

        if (result.value) {
          controller.enqueue(result.value);
        }
      },

      cancel() {
        stdoutReader?.releaseLock();
        stderrReader?.releaseLock();
      },
    });
  }
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return value instanceof ReadableStream;
}
