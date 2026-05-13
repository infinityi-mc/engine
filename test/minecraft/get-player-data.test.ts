import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { QueryBus } from "../../src/shared/application/query-bus";
import { CommandBus } from "../../src/shared/application/command-bus";
import { Router } from "../../src/shared/http/router";
import { JwtGuard } from "../../src/shared/http/jwt-guard";
import { noopLogger } from "../../src/shared/observability/logger.port";
import { registerMinecraftRoutes } from "../../src/modules/minecraft/infrastructure/http/minecraft-routes";
import { SCOPES } from "../../src/modules/minecraft/infrastructure/http/scopes";
import { MinecraftCommandPlayerDataAdapter } from "../../src/modules/minecraft/infrastructure/player-data/minecraft-command-player-data.adapter";
import { parsePlayerDataFeedbackLine } from "../../src/modules/minecraft/infrastructure/player-data/snbt-player-data-parser";
import { GET_PLAYER_DATA_QUERY, GetPlayerDataQuery } from "../../src/modules/minecraft/application/queries/get-player-data.query";
import { GetPlayerDataHandler } from "../../src/modules/minecraft/application/queries/get-player-data.handler";
import { GetPlayerInfoTool } from "../../src/modules/agent/infrastructure/tools/get-player-info.tool";
import { MinecraftPlayerOfflineError } from "../../src/modules/minecraft/domain/errors/minecraft-player-offline.error";
import type { MinecraftServerRepositoryPort } from "../../src/modules/minecraft/domain/ports/minecraft-server-repository.port";
import type { MinecraftStdinPort } from "../../src/modules/minecraft/domain/ports/minecraft-stdin.port";
import type { MinecraftLogPort, LogLineCallback } from "../../src/modules/minecraft/domain/ports/minecraft-log.port";
import type { ServerRegistryPort } from "../../src/modules/server/domain/ports/server-registry.port";
import type { MinecraftServer } from "../../src/modules/minecraft/domain/types/minecraft-server";
import type { ServerInstance } from "../../src/modules/server/domain/types/server-instance";
import type { PlayerDataResult } from "../../src/modules/minecraft/domain/types/player-data";

function fakeServer(overrides: Partial<MinecraftServer> = {}): MinecraftServer {
  return {
    id: "survival",
    name: "Survival Server",
    directory: "/srv/minecraft",
    javaPath: "java",
    jarFile: "server.jar",
    jvmArgs: [],
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
  const map = new Map(servers.map((server) => [server.id, server]));
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
  const callbacks = new Set<LogLineCallback>();
  return {
    emitLine: (line: string) => {
      for (const callback of callbacks) callback(line);
    },
    onLogLine: (_serverId, callback: LogLineCallback) => {
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
    createSSEStream: () => new ReadableStream(),
  };
}

function fakeServerRegistry(status: "running" | "stopped" = "running"): ServerRegistryPort {
  return {
    get: async () => (status === "running" ? fakeInstance() : undefined),
    list: async () => [],
    register: async () => {},
    unregister: async () => {},
    updateStatus: async () => {},
  };
}

describe("player data parser", () => {
  test("parses entity data and excludes noisy root fields", () => {
    const feedback = parsePlayerDataFeedbackLine(
      '[19:45:17] [Server thread/INFO]: [Player] InfinityI has the following entity data: {seenCredits: 1b, DeathTime: 0s, recipeBook: {recipes: ["minecraft:crafting_table"]}, attributes: [{id: "minecraft:max_health"}], Pos: [1.0d, 64.0d, -2.5d], Inventory: [{Slot: 0b, id: "minecraft:stone", count: 1}], UUID: [I; 1, 2, 3, 4]}',
      "InfinityI",
    );

    expect(feedback.kind).toBe("data");
    if (feedback.kind !== "data") return;
    expect(feedback.data.seenCredits).toBe("1b");
    expect(feedback.data.recipeBook).toBeUndefined();
    expect(feedback.data.attributes).toBeUndefined();
    expect(feedback.data.Pos).toEqual(["1.0d", "64.0d", "-2.5d"]);
    expect(feedback.data.Inventory).toEqual([{ Slot: "0b", id: "minecraft:stone", count: "1" }]);
    expect(feedback.data.UUID).toEqual(["1", "2", "3", "4"]);
  });

  test("detects offline player feedback", () => {
    const feedback = parsePlayerDataFeedbackLine(
      "[19:46:00] [Server thread/INFO]: No entity was found",
      "InfinityI",
    );

    expect(feedback.kind).toBe("offline");
  });

  test("parses quoted string escapes without dropping unknown escape markers", () => {
    const feedback = parsePlayerDataFeedbackLine(
      '[19:45:17] [Server thread/INFO]: [Player] InfinityI has the following entity data: {CustomName: "Line\\nTab\\tUnknown\\xQuote\\\""}',
      "InfinityI",
    );

    expect(feedback.kind).toBe("data");
    if (feedback.kind !== "data") return;
    expect(feedback.data.CustomName).toBe('Line\nTab\tUnknown\\xQuote"');
  });
});

describe("MinecraftCommandPlayerDataAdapter", () => {
  test("sends data command and returns parsed player data", async () => {
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const originalSend = stdin.sendCommand.bind(stdin);
    stdin.sendCommand = async (serverId, command) => {
      await originalSend(serverId, command);
      setTimeout(() => {
        logPort.emitLine('[19:45:17] [Server thread/INFO]: [Player] InfinityI has the following entity data: {Health: 20.0f, recipeBook: {recipes: []}}');
      }, 10);
    };

    const adapter = new MinecraftCommandPlayerDataAdapter(
      fakeRepository([fakeServer()]),
      fakeServerRegistry(),
      stdin,
      logPort,
      noopLogger,
      200,
    );

    const result = await adapter.getPlayerData("survival", "InfinityI");

    expect(result.playerName).toBe("InfinityI");
    expect(result.data).toEqual({ Health: "20.0f" });
    expect(stdin.commands).toEqual(["data get entity InfinityI"]);
  });

  test("throws when the player is offline", async () => {
    const stdin = fakeStdin();
    const logPort = fakeLogPort();
    const originalSend = stdin.sendCommand.bind(stdin);
    stdin.sendCommand = async (serverId, command) => {
      await originalSend(serverId, command);
      setTimeout(() => logPort.emitLine("[19:46:00] [Server thread/INFO]: No entity was found"), 10);
    };

    const adapter = new MinecraftCommandPlayerDataAdapter(
      fakeRepository([fakeServer()]),
      fakeServerRegistry(),
      stdin,
      logPort,
      noopLogger,
      200,
    );

    await expect(adapter.getPlayerData("survival", "InfinityI")).rejects.toThrow(MinecraftPlayerOfflineError);
  });
});

describe("GetPlayerInfoTool", () => {
  test("returns player info from query bus", async () => {
    const queryBus = new QueryBus();
    queryBus.register(GET_PLAYER_DATA_QUERY, {
      handle: async (query: GetPlayerDataQuery): Promise<PlayerDataResult> => ({
        serverId: query.serverId,
        playerName: query.playerName,
        data: { Health: "20.0f" },
      }),
    });
    const tool = new GetPlayerInfoTool(queryBus, noopLogger);

    const result = await tool.execute({ serverId: "survival", playerName: "InfinityI" });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.output)).toEqual({
      serverId: "survival",
      playerName: "InfinityI",
      data: { Health: "20.0f" },
      online: true,
    });
  });
});

describe("player info HTTP route", () => {
  test("returns player data over HTTP", async () => {
    const queryBus = new QueryBus();
    queryBus.register(
      GET_PLAYER_DATA_QUERY,
      new GetPlayerDataHandler({
        getPlayerData: async (serverId, playerName) => ({
          serverId,
          playerName,
          data: { Health: "20.0f" },
        }),
      }),
    );
    const router = new Router();
    const secret = "test-secret-key-for-unit-tests";
    const guard = new JwtGuard({ secret, issuer: undefined, audience: undefined });
    registerMinecraftRoutes(router, new CommandBus(), queryBus, guard, noopLogger);
    const token = await new SignJWT({ scope: SCOPES.SERVER_READ })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));

    const response = await router.handle(new Request("http://localhost/minecraft/servers/survival/players/InfinityI/info", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      serverId: "survival",
      playerName: "InfinityI",
      online: true,
      data: { Health: "20.0f" },
    });
  });
});
