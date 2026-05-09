import { describe, expect, test } from "bun:test";
import { RunPythonTool } from "../../src/modules/agent/infrastructure/tools/run-python.tool";
import type { TerminalPort, TerminalResult } from "../../src/modules/system/domain/ports/terminal.port";
import { noopLogger } from "../../src/shared/observability/logger.port";

const DETECTION_RESULT: TerminalResult = {
  command: "python3",
  args: ["--version"],
  exitCode: 0,
  stdout: "Python 3.12.0",
  stderr: "",
  durationMs: 10,
};

function result(overrides: Partial<TerminalResult> = {}): TerminalResult {
  return {
    command: "python3",
    args: [],
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 10,
    ...overrides,
  };
}

function makeTerminal(executeFn: (opts: Parameters<TerminalPort["execute"]>[0]) => Promise<TerminalResult>): TerminalPort {
  return {
    execute: async (opts) => {
      if (opts.args?.[0] === "--version") {
        return DETECTION_RESULT;
      }
      return executeFn(opts);
    },
  };
}

function makeAlwaysFailingTerminal(): TerminalPort {
  return {
    execute: async () => {
      throw new Error("command not found");
    },
  };
}

function createTool(terminal: TerminalPort): RunPythonTool {
  return new RunPythonTool(terminal, noopLogger);
}

describe("RunPythonTool", () => {
  test("has correct name, description, and inputSchema", () => {
    const tool = new RunPythonTool(makeAlwaysFailingTerminal(), noopLogger);

    expect(tool.name).toBe("run_python");
    expect(tool.description).toContain("Python");
    expect(tool.inputSchema).toHaveProperty("properties.code");
    expect((tool.inputSchema as Record<string, unknown>).required).toEqual(["code"]);
  });

  test("returns error when Python is not installed", async () => {
    const tool = createTool(makeAlwaysFailingTerminal());

    const output = await tool.execute({ code: "print('hi')" });
    expect(output.isError).toBe(true);
    expect(output.output).toContain("not installed");
  });

  test("returns error for empty code field", async () => {
    const tool = createTool(makeTerminal(async () => result()));

    const output = await tool.execute({ code: "" });
    expect(output.isError).toBe(true);
    expect(output.output).toContain("code");
  });

  test("falls back to python when python3 is unavailable", async () => {
    let detectedCommand: string | undefined;
    const terminal: TerminalPort = {
      execute: async (opts) => {
        if (opts.args?.[0] === "--version") {
          if (opts.command === "python3") {
            throw new Error("command not found");
          }
          return { ...DETECTION_RESULT, command: "python" };
        }
        detectedCommand = opts.command;
        return result({ stdout: "ok\n" });
      },
    };
    const tool = createTool(terminal);

    const output = await tool.execute({ code: "print('ok')" });

    expect(output.isError).toBe(false);
    expect(detectedCommand).toBe("python");
  });

  test("returns error for missing code field", async () => {
    const tool = createTool(makeTerminal(async () => result()));

    const output = await tool.execute({ foo: "bar" });
    expect(output.isError).toBe(true);
    expect(output.output).toContain("code");
  });

  test("returns error for non-string code field", async () => {
    const tool = createTool(makeTerminal(async () => result()));

    const output = await tool.execute({ code: 123 });
    expect(output.isError).toBe(true);
    expect(output.output).toContain("code");
  });

  test("returns error for null input", async () => {
    const tool = createTool(makeTerminal(async () => result()));

    const output = await tool.execute(null);
    expect(output.isError).toBe(true);
  });

  test("returns error for invalid timeout", async () => {
    const tool = createTool(makeTerminal(async () => result()));

    const output = await tool.execute({ code: "print(1)", timeout: -5 });
    expect(output.isError).toBe(true);
    expect(output.output).toContain("timeout");
  });

  test("returns error for timeout exceeding max", async () => {
    const tool = createTool(makeTerminal(async () => result()));

    const output = await tool.execute({ code: "print(1)", timeout: 999_999 });
    expect(output.isError).toBe(true);
    expect(output.output).toContain("timeout");
  });

  test("executes Python code and returns stdout", async () => {
    let capturedArgs: string[] | undefined;
    const tool = createTool(
      makeTerminal(async (opts) => {
        capturedArgs = opts.args;
        return result({ stdout: "hello world\n", exitCode: 0 });
      }),
    );

    const output = await tool.execute({ code: "print('hello world')" });

    expect(output.isError).toBe(false);
    expect(output.output).toBe("hello world\n");
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs![0]!).toMatch(/run_python_.*\.py$/);
  });

  test("returns isError for non-zero exit code", async () => {
    const tool = createTool(
      makeTerminal(async () =>
        result({
          stdout: "",
          stderr: "Traceback (most recent call last):\n  ...\nZeroDivisionError",
          exitCode: 1,
        }),
      ),
    );

    const output = await tool.execute({ code: "1/0" });

    expect(output.isError).toBe(true);
    expect(output.output).toContain("ZeroDivisionError");
  });

  test("combines stdout and stderr in output", async () => {
    const tool = createTool(
      makeTerminal(async () =>
        result({
          stdout: "line1\n",
          stderr: "warning\n",
          exitCode: 0,
        }),
      ),
    );

    const output = await tool.execute({ code: "import sys; print('line1'); print('warning', file=sys.stderr)" });

    expect(output.isError).toBe(false);
    expect(output.output).toContain("line1");
    expect(output.output).toContain("warning");
  });

  test("returns '(no output)' when stdout and stderr are empty", async () => {
    const tool = createTool(makeTerminal(async () => result({ stdout: "", stderr: "", exitCode: 0 })));

    const output = await tool.execute({ code: "pass" });

    expect(output.isError).toBe(false);
    expect(output.output).toBe("(no output)");
  });

  test("passes timeout to terminal", async () => {
    let capturedTimeout: number | undefined;
    const tool = createTool(
      makeTerminal(async (opts) => {
        capturedTimeout = opts.timeoutMs;
        return result({ stdout: "ok\n" });
      }),
    );

    await tool.execute({ code: "print('ok')", timeout: 5000 });

    expect(capturedTimeout).toBe(5000);
  });

  test("uses default timeout of 30000ms when not specified", async () => {
    let capturedTimeout: number | undefined;
    const tool = createTool(
      makeTerminal(async (opts) => {
        capturedTimeout = opts.timeoutMs;
        return result();
      }),
    );

    await tool.execute({ code: "pass" });

    expect(capturedTimeout).toBe(30_000);
  });

  test("cleans up temp file after execution", async () => {
    let capturedArgs: string[] | undefined;
    const tool = createTool(
      makeTerminal(async (opts) => {
        capturedArgs = opts.args;
        return result({ stdout: "done\n" });
      }),
    );

    await tool.execute({ code: "print('done')" });

    const tempFile = capturedArgs![0]!;
    const exists = await Bun.file(tempFile).exists();
    expect(exists).toBe(false);
  });

  test("cleans up temp file even when terminal throws", async () => {
    let capturedArgs: string[] | undefined;
    const tool = createTool(
      makeTerminal(async (opts) => {
        capturedArgs = opts.args;
        throw new Error("timeout");
      }),
    );

    const output = await tool.execute({ code: "while True: pass" });

    expect(output.isError).toBe(true);
    const tempFile = capturedArgs![0]!;
    const exists = await Bun.file(tempFile).exists();
    expect(exists).toBe(false);
  });
});
