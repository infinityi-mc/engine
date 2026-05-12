import { describe, expect, test } from "bun:test";
import { SendMinecraftCommandsTool } from "../../src/modules/agent/infrastructure/tools/send-minecraft-commands.tool";
import type { MinecraftServerRepositoryPort } from "../../src/modules/minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../src/modules/minecraft/domain/ports/minecraft-stdin.port";
import type { MinecraftLogPort, LogLineCallback } from "../../src/modules/minecraft/domain/ports/minecraft-log.port";
import type { ServerRegistryPort } from "../../src/modules/server/domain/ports/server-registry.port";
import type { MinecraftServer } from "../../src/modules/minecraft/domain/types/minecraft-server";
import type { ServerInstance } from "../../src/modules/server/domain/types/server-instance";
import { noopLogger } from "../../src/shared/observability/logger.port";

function fakeServer(overrides: Partial<MinecraftServer> = {}): MinecraftServer {
  return {
    id: "survival",
    name: "Survival Server",
    directory: "/srv/minecraft",
    javaPath: "java",
    jarFile: "server.jar",
    jvmArgs: ["-Xmx4G"],
    serverArgs: ["--nogui"],
    ...overrides,
  };
}

function fakeInstance(overrides: Partial<ServerInstance> = {}): ServerInstance {
  return {
    id: "survival",
    pid: 12345,
    command: "java",
    args: ["-jar", "server.jar"],
    cwd: "/srv/minecraft",
    status: "running",
    startedAt: new Date(),
    stoppedAt: undefined,
    ...overrides,
  };
}

function fakeRepository(servers: MinecraftServer[] = []): MinecraftServerRepositoryPort {
  const map = new Map(servers.map((s) => [s.id, s]));
  return {
    get: async (id) => map.get(id),
    list: async () => [...map.values()],
    save: async () => {},
    remove: async () => {},
  };
}

function fakeStdin(): MinecraftStdinPort & { commands: string[] } {
  const sent: string[] = [];
  return {
    commands: sent,
    sendCommand: async (_serverId, command) => { sent.push(command); },
  };
}

function fakeLogPort(): MinecraftLogPort & { emitLine: (line: string) => void } {
  let emitLine: (line: string) => void = () => {};
  return {
    emitLine: (line: string) => emitLine(line),
    onLogLine: (_serverId, callback: LogLineCallback) => {
      emitLine = callback;
      return () => { emitLine = () => {}; };
    },
    createSSEStream: () => new ReadableStream(),
  };
}

function fakeServerRegistry(status: "running" | "stopped" | "crashed" = "running"): ServerRegistryPort {
  return {
    get: async () => (status === "running" ? fakeInstance() : undefined),
    list: async () => [],
    register: async () => {},
    unregister: async () => {},
    updateStatus: async () => {},
  };
}

describe("SendMinecraftCommandsTool", () => {
  test("sends single command and captures feedback", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    // Simulate server output after command
    const originalSend = stdin.sendCommand.bind(stdin);
    stdin.sendCommand = async (serverId, command) => {
      await originalSend(serverId, command);
      setTimeout(() => logPort.emitLine("[Server] Set the time to 1000"), 10);
    };

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["time set 1000"] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].command).toBe("time set 1000");
    expect(stdin.commands).toEqual(["time set 1000"]);
  });

  test("sends multiple commands sequentially", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["time set day", "weather clear", "give @a diamond"] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0].command).toBe("time set day");
    expect(parsed.results[1].command).toBe("weather clear");
    expect(parsed.results[2].command).toBe("give @a diamond");
    expect(stdin.commands).toEqual(["time set day", "weather clear", "give @a diamond"]);
  });

  test("blocks commands matching blacklist prefix", async () => {
    const server = fakeServer({
      agents: [{ id: "restricted-agent", commands: ["stop", "op "] }],
    });
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["op Player1", "tp Player1 0 64 0"] },
      { agentId: "restricted-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("blocked");
    expect(result.output).toContain("op Player1");
    expect(stdin.commands).toEqual([]);
  });

  test("allows commands not matching blacklist", async () => {
    const server = fakeServer({
      agents: [{ id: "restricted-agent", commands: ["stop", "op "] }],
    });
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["tp Player1 0 64 0", "give Player1 diamond"] },
      { agentId: "restricted-agent" },
    );

    expect(result.isError).toBeFalsy();
    expect(stdin.commands).toEqual(["tp Player1 0 64 0", "give Player1 diamond"]);
  });

  test("allows all commands when no agent access entry exists", async () => {
    const server = fakeServer({ agents: [] });
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["stop"] },
      { agentId: "unknown-agent" },
    );

    expect(result.isError).toBeFalsy();
    expect(stdin.commands).toEqual(["stop"]);
  });

  test("allows all commands when no context provided", async () => {
    const server = fakeServer({
      agents: [{ id: "some-agent", commands: ["stop"] }],
    });
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute({ serverId: "survival", commands: ["stop"] });

    expect(result.isError).toBeFalsy();
    expect(stdin.commands).toEqual(["stop"]);
  });

  test("returns error when server not found", async () => {
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "nonexistent", commands: ["list"] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("returns error when server is not running", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry("stopped");

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["list"] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not running");
  });

  test("returns error for empty commands array", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: [] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("commands");
  });

  test("returns error for missing serverId", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute({ commands: ["list"] });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("serverId");
  });

  test("returns error for non-string command", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["valid", 123] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("commands[1]");
  });

  test("returns error when commands exceed max", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const commands = Array.from({ length: 17 }, (_, i) => `say ${i}`);
    const result = await tool.execute(
      { serverId: "survival", commands },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("16");
  });

  test("blacklist with empty string blocks all commands", async () => {
    const server = fakeServer({
      agents: [{ id: "locked-agent", commands: [""] }],
    });
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["list"] },
      { agentId: "locked-agent" },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("blocked");
  });

  test("feedback captures lines emitted during timeout window", async () => {
    const server = fakeServer();
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const registry = fakeServerRegistry();

    // Emit lines shortly after command is sent
    const originalSend = stdin.sendCommand.bind(stdin);
    stdin.sendCommand = async (serverId, command) => {
      await originalSend(serverId, command);
      setTimeout(() => {
        logPort.emitLine("[12:34:56] [Server thread/INFO]: Set the time to 1000");
        logPort.emitLine("[12:34:56] [Server thread/INFO]: Done");
      }, 10);
    };

    const tool = new SendMinecraftCommandsTool(
      fakeRepository([server]), stdin, logPort, registry, noopLogger,
    );

    const result = await tool.execute(
      { serverId: "survival", commands: ["time set 1000"] },
      { agentId: "test-agent" },
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.results[0].feedback).toContain("[12:34:56] [Server thread/INFO]: Set the time to 1000");
    expect(parsed.results[0].feedback).toContain("[12:34:56] [Server thread/INFO]: Done");
  });
});
