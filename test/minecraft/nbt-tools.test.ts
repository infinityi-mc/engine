import { describe, expect, test } from "bun:test";
import {
  NbtReadTool,
  NbtGetTool,
  NbtSearchTool,
  NbtKeysTool,
  NbtStructureTool,
} from "../../src/modules/agent/infrastructure/tools/nbt-tools";
import type { NbtPort } from "../../src/modules/minecraft/domain/ports/nbt.port";
import { NbtFileNotFoundError } from "../../src/modules/minecraft/domain/errors/nbt-file-not-found.error";
import { NbtPathNotFoundError } from "../../src/modules/minecraft/domain/errors/nbt-path-not-found.error";
import { noopLogger } from "../../src/shared/observability/logger.port";

function fakeNbtPort(overrides: Partial<NbtPort> = {}): NbtPort {
  const defaults: NbtPort = {
    read: async () => ({
      type: "compound",
      value: { Data: { type_hint: "{compound, 3 keys}" } },
    }),
    get: async (_filePath, dotPath) => ({
      type: "string",
      value: `value at ${dotPath}`,
    }),
    search: async () => ["Data.Player.Pos", "Data.Player.Inventory"],
    keys: async () => [
      { key: "Data", type: "compound" },
      { key: "Version", type: "compound" },
    ],
    structure: async () => [
      { path: "Data", type: "compound" },
      { path: "Data.Player", type: "compound" },
    ],
  };
  return { ...defaults, ...overrides };
}

describe("NbtReadTool", () => {
  test("happy path returns JSON with truncated tree", async () => {
    const tool = new NbtReadTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      depth: 3,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.type).toBe("compound");
  });

  test("rejects missing filePath", async () => {
    const tool = new NbtReadTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({ depth: 3 });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("filePath");
  });

  test("rejects missing depth", async () => {
    const tool = new NbtReadTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({ filePath: "/path/to/level.dat" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("depth");
  });

  test("rejects depth > 10", async () => {
    const tool = new NbtReadTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      depth: 11,
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("10");
  });

  test("rejects depth < 1", async () => {
    const tool = new NbtReadTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      depth: 0,
    });
    expect(result.isError).toBe(true);
  });

  test("returns NbtFileNotFoundError as tool error", async () => {
    const port = fakeNbtPort({
      read: async () => {
        throw new NbtFileNotFoundError("/missing.dat");
      },
    });
    const tool = new NbtReadTool(port, noopLogger);
    const result = await tool.execute({
      filePath: "/missing.dat",
      depth: 3,
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });
});

describe("NbtGetTool", () => {
  test("happy path returns value at path", async () => {
    const tool = new NbtGetTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      path: "Data.Player.Pos",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.type).toBe("string");
  });

  test("rejects missing path", async () => {
    const tool = new NbtGetTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({ filePath: "/path/to/level.dat" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("path");
  });

  test("returns NbtPathNotFoundError as tool error", async () => {
    const port = fakeNbtPort({
      get: async () => {
        throw new NbtPathNotFoundError("/file.dat", "Missing.Path");
      },
    });
    const tool = new NbtGetTool(port, noopLogger);
    const result = await tool.execute({
      filePath: "/file.dat",
      path: "Missing.Path",
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Path not found");
  });
});

describe("NbtSearchTool", () => {
  test("happy path returns matching paths", async () => {
    const tool = new NbtSearchTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      pattern: "Pos",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.matches).toEqual([
      "Data.Player.Pos",
      "Data.Player.Inventory",
    ]);
  });

  test("rejects empty pattern", async () => {
    const tool = new NbtSearchTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      pattern: "",
    });
    expect(result.isError).toBe(true);
  });

  test("rejects limit > 200", async () => {
    const tool = new NbtSearchTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      pattern: "Pos",
      limit: 201,
    });
    expect(result.isError).toBe(true);
  });

  test("accepts valid limit", async () => {
    const tool = new NbtSearchTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      pattern: "Pos",
      limit: 10,
    });
    expect(result.isError).toBeFalsy();
  });
});

describe("NbtKeysTool", () => {
  test("happy path returns keys at root", async () => {
    const tool = new NbtKeysTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({ filePath: "/path/to/level.dat" });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.keys).toHaveLength(2);
    expect(parsed.keys[0].key).toBe("Data");
  });

  test("happy path with path parameter", async () => {
    const port = fakeNbtPort({
      keys: async (_fp, dotPath) => {
        if (dotPath === "Data") {
          return [
            { key: "Player", type: "compound" },
            { key: "WorldGenSettings", type: "compound" },
          ];
        }
        return [];
      },
    });
    const tool = new NbtKeysTool(port, noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      path: "Data",
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.keys).toHaveLength(2);
  });

  test("returns NbtPathNotFoundError as tool error", async () => {
    const port = fakeNbtPort({
      keys: async () => {
        throw new NbtPathNotFoundError("/file.dat", "Bad.Path");
      },
    });
    const tool = new NbtKeysTool(port, noopLogger);
    const result = await tool.execute({
      filePath: "/file.dat",
      path: "Bad.Path",
    });
    expect(result.isError).toBe(true);
  });
});

describe("NbtStructureTool", () => {
  test("happy path returns structure entries", async () => {
    const tool = new NbtStructureTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      depth: 2,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.entries).toHaveLength(2);
  });

  test("rejects depth > 5", async () => {
    const tool = new NbtStructureTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({
      filePath: "/path/to/level.dat",
      depth: 6,
    });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("5");
  });

  test("rejects missing depth", async () => {
    const tool = new NbtStructureTool(fakeNbtPort(), noopLogger);
    const result = await tool.execute({ filePath: "/path/to/level.dat" });
    expect(result.isError).toBe(true);
  });
});
