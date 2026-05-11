import { describe, expect, test } from "bun:test";
import { InMemoryToolRegistry } from "../../src/modules/agent/infrastructure/registry/tool-registry.adapter";
import type { Tool, ToolResult } from "../../src/modules/agent/domain/types/tool.types";
import type { LoggerPort } from "../../src/shared/observability/logger.port";

const noopLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeTool(name: string, description = `A tool called ${name}`): Tool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
    execute: async (): Promise<ToolResult> => ({ output: `${name} executed` }),
  };
}

function makeToolWithGroups(name: string, groups: readonly string[]): Tool {
  return {
    name,
    description: `A tool called ${name}`,
    inputSchema: { type: "object", properties: {} },
    groups,
    execute: async (): Promise<ToolResult> => ({ output: `${name} executed` }),
  };
}

describe("InMemoryToolRegistry", () => {
  test("registers and retrieves a tool", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool = makeTool("read_file");

    registry.register(tool);

    expect(registry.get("read_file")).toBe(tool);
  });

  test("returns undefined for unknown tool", () => {
    const registry = new InMemoryToolRegistry(noopLogger);

    expect(registry.get("unknown")).toBeUndefined();
  });

  test("getAll returns all registered tools", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool1 = makeTool("read_file");
    const tool2 = makeTool("write_file");

    registry.register(tool1);
    registry.register(tool2);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name).sort()).toEqual(["read_file", "write_file"]);
  });

  test("getDefinitions returns ToolDefinition[] for known names", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool: Tool = {
      name: "read_file",
      description: "Read a file from disk",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: async () => ({ output: "file contents" }),
    };

    registry.register(tool);

    const definitions = registry.getDefinitions(["read_file"]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toEqual({
      name: "read_file",
      description: "Read a file from disk",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    });
  });

  test("getDefinitions skips unknown tool names", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool = makeTool("read_file");
    registry.register(tool);

    const definitions = registry.getDefinitions(["read_file", "unknown_tool"]);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.name).toBe("read_file");
  });

  test("getDefinitions returns empty array for no matches", () => {
    const registry = new InMemoryToolRegistry(noopLogger);

    const definitions = registry.getDefinitions(["foo", "bar"]);
    expect(definitions).toHaveLength(0);
  });

  test("overwrites tool on re-registration", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool1 = makeTool("read_file", "Version 1");
    const tool2 = makeTool("read_file", "Version 2");

    registry.register(tool1);
    registry.register(tool2);

    expect(registry.get("read_file")!.description).toBe("Version 2");
    expect(registry.getAll()).toHaveLength(1);
  });

  test("getDefinitions logs warning for unknown tool names", () => {
    const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const warningLogger: LoggerPort = {
      ...noopLogger,
      warn: (message, context) => {
        const entry: { message: string; context?: Record<string, unknown> } = { message };
        if (context !== undefined) entry.context = context;
        warnings.push(entry);
      },
    };
    const registry = new InMemoryToolRegistry(warningLogger);
    const tool = makeTool("read_file");
    registry.register(tool);

    registry.getDefinitions(["read_file", "typo_tool", "another_missing"]);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.message).toBe("agent.tool_not_found_in_registry");
    expect(warnings[0]!.context).toEqual({ toolName: "typo_tool" });
    expect(warnings[1]!.message).toBe("agent.tool_not_found_in_registry");
    expect(warnings[1]!.context).toEqual({ toolName: "another_missing" });
  });

  test("indexes tool under each of its groups", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool = makeToolWithGroups("read_mc_logs", ["minecraft", "system"]);

    registry.register(tool);

    expect(registry.getByGroup("minecraft")).toEqual([tool]);
    expect(registry.getByGroup("system")).toEqual([tool]);
  });

  test("tool without groups field is not in any group", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const tool = makeTool("read_file");

    registry.register(tool);

    expect(registry.getByGroup("any")).toEqual([]);
  });

  test("getByGroup returns empty array for unknown group", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    registry.register(makeToolWithGroups("foo", ["bar"]));

    expect(registry.getByGroup("unknown")).toEqual([]);
  });

  test("multiple tools share a group", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const a = makeToolWithGroups("a", ["shared"]);
    const b = makeToolWithGroups("b", ["shared"]);

    registry.register(a);
    registry.register(b);

    const members = registry.getByGroup("shared").map((t) => t.name).sort();
    expect(members).toEqual(["a", "b"]);
  });

  test("re-registering a tool with different groups updates the index", () => {
    const registry = new InMemoryToolRegistry(noopLogger);
    const v1 = makeToolWithGroups("dual", ["g1", "g2"]);
    const v2 = makeToolWithGroups("dual", ["g3"]);

    registry.register(v1);
    registry.register(v2);

    expect(registry.getByGroup("g1")).toEqual([]);
    expect(registry.getByGroup("g2")).toEqual([]);
    expect(registry.getByGroup("g3")).toEqual([v2]);
  });
});
