import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigAgentDefinitionRepository } from "../../src/modules/agent/infrastructure/persistence/agent-definition-repository.adapter";
import { InMemoryToolRegistry } from "../../src/modules/agent/infrastructure/registry/tool-registry.adapter";
import type { Tool, ToolResult } from "../../src/modules/agent/domain/types/tool.types";
import type { ConfigPort } from "../../src/shared/config/config.port";
import type { AppConfig } from "../../src/shared/config/config.types";
import type { LoggerPort } from "../../src/shared/observability/logger.port";

const silentLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeToolRegistry(): InMemoryToolRegistry {
  return new InMemoryToolRegistry(silentLogger);
}

function makeGroupedTool(name: string, groups: readonly string[]): Tool {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    groups,
    execute: async (): Promise<ToolResult> => ({ output: "" }),
  };
}

interface FakeConfigPort extends ConfigPort {
  reloadAgentConfig(cfg: AppConfig["agent"]): void;
}

function makeFakeConfig(agentConfig?: AppConfig["agent"]): FakeConfigPort {
  let currentAgentConfig = agentConfig;
  const listeners: Array<(config: AppConfig) => void> = [];

  return {
    getConfig: (): AppConfig => ({
      llm: { defaultProvider: "test", defaultModel: "test-model", providers: {} },
      ...(currentAgentConfig ? { agent: currentAgentConfig } : {}),
    }),
    getLlmConfig: () => ({ defaultProvider: "test", defaultModel: "test-model", providers: {} }),
    getAgentConfig: () => currentAgentConfig,
    getMinecraftAgentConfig: () => ({ messageCap: 50, sessionTtlMs: 172_800_000, playerCooldownMs: 5_000 }),
    getApiKey: () => "",
    getBaseUrl: () => "",
    onChange: (listener: (config: AppConfig) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
    stop: () => {},
    reloadAgentConfig(newAgentConfig: AppConfig["agent"]) {
      currentAgentConfig = newAgentConfig;
      const newConfig: AppConfig = {
        llm: { defaultProvider: "test", defaultModel: "test-model", providers: {} },
        ...(newAgentConfig ? { agent: newAgentConfig } : {}),
      };
      for (const listener of listeners) {
        listener(newConfig);
      }
    },
  };
}

function makeFakeLogger() {
  const warnLogs: Array<{ message: string; context?: Record<string, unknown> }> = [];
  return {
    warnLogs,
    debug: () => {},
    info: () => {},
    warn: (msg: string, ctx?: Record<string, unknown>) => {
      const entry: { message: string; context?: Record<string, unknown> } = { message: msg };
      if (ctx !== undefined) entry.context = ctx;
      warnLogs.push(entry);
    },
    error: () => {},
  } as LoggerPort & { warnLogs: Array<{ message: string; context?: Record<string, unknown> }> };
}

describe("ConfigAgentDefinitionRepository", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(process.cwd(), "agent-repo-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns empty when agent config is undefined", async () => {
    const config = makeFakeConfig(undefined);
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    expect(await repo.getAll()).toHaveLength(0);
    expect(await repo.get("any")).toBeUndefined();
  });

  test("returns empty when agent config has no agents", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {},
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    expect(await repo.getAll()).toHaveLength(0);
  });

  test("loads inline system prompts from config", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "test-agent": {
          name: "Test Agent",
          description: "A test agent",
          systemPrompt: "You are a test agent.",
          tools: ["read_file"],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("test-agent");
    expect(def).toBeDefined();
    expect(def!.id).toBe("test-agent");
    expect(def!.name).toBe("Test Agent");
    expect(def!.systemPrompt).toBe("You are a test agent.");
    expect(def!.tools).toEqual(["read_file"]);
    expect(def!.runtime).toBe("tool-use-loop");
  });

  test("loads file-based system prompts", async () => {
    const promptPath = path.join(tmpDir, "prompt.md");
    const relativePromptPath = path.relative(process.cwd(), promptPath);
    await writeFile(promptPath, "You are a file-based agent.", "utf8");

    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "file-agent": {
          name: "File Agent",
          description: "Agent with file prompt",
          systemPrompt: `file:${relativePromptPath}`,
          tools: [],
          runtime: "single-shot",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("file-agent");
    expect(def).toBeDefined();
    expect(def!.systemPrompt).toBe("You are a file-based agent.");
  });

  test("logs warning and returns raw prompt when file is missing", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "missing-agent": {
          name: "Missing File Agent",
          description: "Agent with missing prompt file",
          systemPrompt: "file:nonexistent/path/prompt.md",
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("missing-agent");
    expect(def).toBeDefined();
    expect(def!.systemPrompt).toBe("file:nonexistent/path/prompt.md");

    expect(logger.warnLogs.filter((l) => l.message === "agent.system_prompt_file_not_found").length).toBeGreaterThan(0);
  });

  test("resolves model override from config", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "custom-model": {
          name: "Custom Model Agent",
          description: "Agent with custom model",
          systemPrompt: "Hello",
          model: { provider: "anthropic", model: "claude-sonnet-4.5" },
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("custom-model");
    expect(def!.model).toEqual({ provider: "anthropic", model: "claude-sonnet-4.5" });
  });

  test("applies defaults for optional fields", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "minimal": {
          name: "Minimal Agent",
          description: "Minimal config",
          systemPrompt: "Hi",
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("minimal");
    expect(def!.runtime).toBe("tool-use-loop");
    expect(def!.model).toBeUndefined();
    expect(def!.maxIterations).toBeUndefined();
    expect(def!.temperature).toBeUndefined();
    expect(def!.maxTokens).toBeUndefined();
  });

  test("getAll returns all definitions", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "agent-a": {
          name: "Agent A",
          description: "First",
          systemPrompt: "A",
          tools: [],
          runtime: "tool-use-loop",
        },
        "agent-b": {
          name: "Agent B",
          description: "Second",
          systemPrompt: "B",
          tools: [],
          runtime: "single-shot",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const all = await repo.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.id).sort()).toEqual(["agent-a", "agent-b"]);
  });

  test("updates definitions on config reload", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "initial-agent": {
          name: "Initial Agent",
          description: "Initial",
          systemPrompt: "Initial prompt",
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    expect(await repo.getAll()).toHaveLength(1);

    // Simulate config reload with different agents
    config.reloadAgentConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "new-agent": {
          name: "New Agent",
          description: "New",
          systemPrompt: "New prompt",
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });

    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("new-agent");
    expect(await repo.get("initial-agent")).toBeUndefined();
  });

  test("rejects path traversal with .. in file: system prompt", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "traversal-agent": {
          name: "Traversal Agent",
          description: "Agent with path traversal",
          systemPrompt: "file:../../../etc/passwd",
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("traversal-agent");
    expect(def).toBeDefined();
    // Should return the raw prompt string, not file contents
    expect(def!.systemPrompt).toBe("file:../../../etc/passwd");

    const traversalWarnings = logger.warnLogs.filter((l) => l.message === "agent.system_prompt_path_traversal_rejected");
    expect(traversalWarnings).toHaveLength(1);
    expect(traversalWarnings[0]!.context).toEqual({ filePath: "../../../etc/passwd" });
  });

  test("rejects absolute path in file: system prompt", async () => {
    const promptPath = path.join(tmpDir, "absolute-prompt.md");
    await writeFile(promptPath, "Absolute path content", "utf8");

    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "absolute-agent": {
          name: "Absolute Agent",
          description: "Agent with absolute path",
          systemPrompt: `file:${promptPath}`,
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("absolute-agent");
    expect(def).toBeDefined();
    expect(def!.systemPrompt).toBe(`file:${promptPath}`);

    // Path traversal warnings
    const traversalWarnings = logger.warnLogs.filter((l) => l.message === "agent.system_prompt_path_traversal_rejected");
    expect(traversalWarnings).toHaveLength(1);
  });

  test("rejects mixed path traversal with .. segments", async () => {
    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "mixed-agent": {
          name: "Mixed Agent",
          description: "Agent with mixed traversal",
          systemPrompt: "file:prompts/../secret/key",
          tools: [],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, makeToolRegistry(), logger);

    const def = await repo.get("mixed-agent");
    expect(def).toBeDefined();
    expect(def!.systemPrompt).toBe("file:prompts/../secret/key");

    const traversalWarnings = logger.warnLogs.filter((l) => l.message === "agent.system_prompt_path_traversal_rejected");
    expect(traversalWarnings).toHaveLength(1);
  });

  test("resolves group: references to member tool names", async () => {
    const registry = makeToolRegistry();
    registry.register(makeGroupedTool("read_mc_logs", ["minecraft"]));
    registry.register(makeGroupedTool("send_mc_cmd", ["minecraft"]));
    registry.register(makeGroupedTool("run_python", []));

    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "grouped": {
          name: "Grouped",
          description: "Agent with group ref",
          systemPrompt: "hi",
          tools: ["run_python", "group:minecraft"],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, registry, logger);

    const def = await repo.get("grouped");
    expect(def).toBeDefined();
    expect(def!.tools).toEqual(["run_python", "read_mc_logs", "send_mc_cmd"]);
  });

  test("warns and skips unknown group, preserving individual tools", async () => {
    const registry = makeToolRegistry();
    registry.register(makeGroupedTool("run_python", []));

    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "unknown-group": {
          name: "Unknown Group Agent",
          description: "d",
          systemPrompt: "hi",
          tools: ["run_python", "group:does_not_exist"],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, registry, logger);

    const def = await repo.get("unknown-group");
    expect(def!.tools).toEqual(["run_python"]);

    const warns = logger.warnLogs.filter((l) => l.message === "agent.tool_group_empty_or_unknown");
    expect(warns).toHaveLength(1);
    expect(warns[0]!.context).toEqual({ agentId: "unknown-group", groupName: "does_not_exist" });
  });

  test("warns on empty group (no tools registered under that name)", async () => {
    const registry = makeToolRegistry();
    registry.register(makeGroupedTool("foo", ["other"]));

    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "empty-group": {
          name: "Empty Group Agent",
          description: "d",
          systemPrompt: "hi",
          tools: ["group:empty"],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, registry, logger);

    const def = await repo.get("empty-group");
    expect(def!.tools).toEqual([]);
    const warns = logger.warnLogs.filter((l) => l.message === "agent.tool_group_empty_or_unknown");
    expect(warns).toHaveLength(1);
  });

  test("dedupes when a tool is referenced both directly and via group", async () => {
    const registry = makeToolRegistry();
    registry.register(makeGroupedTool("run_python", ["scripting"]));
    registry.register(makeGroupedTool("run_bash", ["scripting"]));

    const config = makeFakeConfig({
      defaultMaxIterations: 10,
      defaultTimeoutMs: 300_000,
      agents: {
        "dedupe": {
          name: "Dedupe Agent",
          description: "d",
          systemPrompt: "hi",
          tools: ["run_python", "group:scripting"],
          runtime: "tool-use-loop",
        },
      },
    });
    const logger = makeFakeLogger();
    const repo = new ConfigAgentDefinitionRepository(config, registry, logger);

    const def = await repo.get("dedupe");
    expect(def!.tools).toEqual(["run_python", "run_bash"]);
  });
});
