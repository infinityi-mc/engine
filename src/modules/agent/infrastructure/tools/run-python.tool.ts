import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalPort } from "../../../system/domain/ports/terminal.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Tool, ToolResult } from "../../domain/types/tool.types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

export class RunPythonTool implements Tool {
  readonly name = "run_python";
  readonly description = "Execute Python code and return stdout, stderr, and exit code.";
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      code: { type: "string", description: "The Python code to execute." },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}).`,
      },
    },
    required: ["code"],
  };

  private pythonPath: string | null = null;
  private detectPromise: Promise<void>;

  constructor(
    private readonly terminal: TerminalPort,
    private readonly logger: LoggerPort,
  ) {
    this.detectPromise = this.detectPython();
  }

  async execute(input: unknown): Promise<ToolResult> {
    const parsed = validateInput(input);
    if (!parsed.ok) {
      return { output: parsed.error, isError: true };
    }

    const { code, timeoutMs } = parsed.value;

    try {
      await this.detectPromise;
    } catch {
      return { output: "Python detection failed unexpectedly.", isError: true };
    }

    if (this.pythonPath === null) {
      return { output: "Python is not installed or not found on PATH.", isError: true };
    }

    const tempFile = join(tmpdir(), `run_python_${randomUUID()}.py`);

    try {
      await Bun.write(tempFile, code);

      const result = await this.terminal.execute({
        command: this.pythonPath,
        args: [tempFile],
        timeoutMs,
      });

      const output = [result.stdout, result.stderr].filter((s) => s.length > 0).join("\n");

      this.logger.info("agent.tool.run_python.executed", {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });

      return {
        output: output.length > 0 ? output : "(no output)",
        isError: result.exitCode !== 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn("agent.tool.run_python.error", { error: message });

      return { output: `Failed to execute Python code: ${message}`, isError: true };
    } finally {
      await Bun.file(tempFile).delete().catch(() => {});
    }
  }

  private async detectPython(): Promise<void> {
    for (const candidate of ["python3", "python"]) {
      try {
        const result = await this.terminal.execute({
          command: candidate,
          args: ["--version"],
          timeoutMs: 5000,
        });
        if (result.exitCode === 0) {
          this.pythonPath = candidate;
          this.logger.info("agent.tool.run_python.detected", { pythonPath: candidate });
          return;
        }
      } catch (error) {
        this.logger.debug("agent.tool.run_python.detect_failed", {
          candidate,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.logger.warn("agent.tool.run_python.not_found");
  }
}

function validateInput(input: unknown):
  | { ok: true; value: { code: string; timeoutMs: number } }
  | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Input must be an object." };
  }

  const record = input as Record<string, unknown>;

  if (typeof record.code !== "string" || record.code.length === 0) {
    return { ok: false, error: "Missing or invalid required field: code (non-empty string)." };
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (record.timeout !== undefined) {
    if (typeof record.timeout !== "number" || !Number.isFinite(record.timeout) || record.timeout < 1) {
      return { ok: false, error: "timeout must be a positive number." };
    }
    if (record.timeout > MAX_TIMEOUT_MS) {
      return { ok: false, error: `timeout must not exceed ${MAX_TIMEOUT_MS}ms.` };
    }
    timeoutMs = record.timeout;
  }

  return { ok: true, value: { code: record.code, timeoutMs } };
}
