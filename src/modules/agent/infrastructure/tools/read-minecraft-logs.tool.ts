import { join } from "node:path";
import type { MinecraftServerRepositoryPort } from "../../../minecraft/domain/ports/minecraft-server-repository.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Tool, ToolResult } from "../../domain/types/tool.types";

const DEFAULT_LINES = 100;
const MAX_LINES = 5000;

export class ReadMinecraftLogsTool implements Tool {
  readonly name = "read_minecraft_logs";
  readonly description =
    "Read log output from a Minecraft server. Returns the most recent lines from the server log file.";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      serverId: {
        type: "string",
        description: "The ID of the Minecraft server.",
      },
      lines: {
        type: "number",
        description: `Number of lines to return from the end (default: ${DEFAULT_LINES}, max: ${MAX_LINES}).`,
      },
      offset: {
        type: "number",
        description:
          "Number of lines to skip from the end before reading (default: 0). Use for pagination — e.g., offset=100 skips the last 100 lines.",
      },
    },
    required: ["serverId"],
  };

  constructor(
    private readonly repository: MinecraftServerRepositoryPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const parsed = validateInput(input);
    if (!parsed.ok) {
      return { output: parsed.error, isError: true };
    }

    const { serverId, lines, offset } = parsed.value;

    const server = await this.repository.get(serverId);
    if (server === undefined) {
      return { output: `Minecraft server not found: ${serverId}`, isError: true };
    }

    const logPath = join(server.directory, "logs", "latest.log");
    const file = Bun.file(logPath);

    if (!(await file.exists())) {
      return { output: `Log file not found: ${logPath}`, isError: true };
    }

    try {
      const content = await file.text();
      const allLines = content.split("\n");

      // offset=0 means "from the end", offset=100 means "skip last 100 lines"
      const end = offset > 0 ? allLines.length - offset : allLines.length;
      const start = Math.max(0, end - lines);
      const sliced = allLines.slice(start, Math.max(0, end));

      this.logger.info("agent.tool.read_minecraft_logs.executed", {
        serverId,
        totalLines: allLines.length,
        returnedLines: sliced.length,
        offset,
      });

      if (sliced.length === 0) {
        return { output: "(no log lines at this offset)", isError: false };
      }

      return { output: sliced.join("\n"), isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("agent.tool.read_minecraft_logs.error", {
        serverId,
        error: message,
      });
      return { output: `Failed to read log file: ${message}`, isError: true };
    }
  }
}

function validateInput(
  input: unknown,
):
  | { ok: true; value: { serverId: string; lines: number; offset: number } }
  | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Input must be an object." };
  }

  const record = input as Record<string, unknown>;

  if (typeof record.serverId !== "string" || record.serverId.length === 0) {
    return { ok: false, error: "Missing or invalid required field: serverId (non-empty string)." };
  }

  let lines = DEFAULT_LINES;
  if (record.lines !== undefined) {
    if (typeof record.lines !== "number" || !Number.isInteger(record.lines) || record.lines < 1) {
      return { ok: false, error: "lines must be a positive integer." };
    }
    lines = Math.min(record.lines, MAX_LINES);
  }

  let offset = 0;
  if (record.offset !== undefined) {
    if (
      typeof record.offset !== "number" ||
      !Number.isInteger(record.offset) ||
      record.offset < 0
    ) {
      return { ok: false, error: "offset must be a non-negative integer." };
    }
    offset = record.offset;
  }

  return { ok: true, value: { serverId: record.serverId, lines, offset } };
}
