import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { Router } from "../../src/shared/http/router";
import { JwtGuard } from "../../src/shared/http/jwt-guard";
import { registerMinecraftRoutes } from "../../src/modules/minecraft/infrastructure/http/minecraft-routes";
import { SCOPES } from "../../src/modules/minecraft/infrastructure/http/scopes";
import { JsonMinecraftServerRepositoryAdapter } from "../../src/modules/minecraft/infrastructure/persistence/json-minecraft-server-repository.adapter";
import { BunServerProcessAdapter } from "../../src/modules/server/infrastructure/process/bun-server-process.adapter";
import { InMemoryServerRegistryAdapter } from "../../src/modules/server/infrastructure/registry/in-memory-server-registry.adapter";
import { EventBus } from "../../src/shared/application/event-bus";
import { BunMinecraftStdinAdapter } from "../../src/modules/minecraft/infrastructure/process/bun-minecraft-stdin.adapter";
import { BunMinecraftLogAdapter } from "../../src/modules/minecraft/infrastructure/process/bun-minecraft-log.adapter";
import { waitForProcessExit } from "../../src/modules/minecraft/infrastructure/process/wait-for-exit";
import { InMemoryPatternRegistryAdapter } from "../../src/modules/minecraft/infrastructure/registry/in-memory-pattern-registry.adapter";
import { MinecraftLogListener } from "../../src/modules/minecraft/infrastructure/listeners/minecraft-log.listener";
import { CommandBus } from "../../src/shared/application/command-bus";
import { CreateMinecraftServerHandler } from "../../src/modules/minecraft/application/commands/create-minecraft-server.handler";
import { StartMinecraftServerHandler } from "../../src/modules/minecraft/application/commands/start-minecraft-server.handler";
import { StopMinecraftServerHandler } from "../../src/modules/minecraft/application/commands/stop-minecraft-server.handler";
import { DeleteMinecraftServerHandler } from "../../src/modules/minecraft/application/commands/delete-minecraft-server.handler";
import { SendMinecraftCommandHandler } from "../../src/modules/minecraft/application/commands/send-minecraft-command.handler";
import { ListMinecraftServersHandler } from "../../src/modules/minecraft/application/queries/list-minecraft-servers.handler";
import { GetMinecraftServerHandler } from "../../src/modules/minecraft/application/queries/get-minecraft-server.handler";
import { CreateMinecraftServerCommand } from "../../src/modules/minecraft/application/commands/create-minecraft-server.command";
import { StartMinecraftServerCommand } from "../../src/modules/minecraft/application/commands/start-minecraft-server.command";
import { StopMinecraftServerCommand } from "../../src/modules/minecraft/application/commands/stop-minecraft-server.command";
import { DeleteMinecraftServerCommand } from "../../src/modules/minecraft/application/commands/delete-minecraft-server.command";
import { SendMinecraftCommandCommand } from "../../src/modules/minecraft/application/commands/send-minecraft-command.command";
import { ListMinecraftServersQuery } from "../../src/modules/minecraft/application/queries/list-minecraft-servers.query";
import { GetMinecraftServerQuery } from "../../src/modules/minecraft/application/queries/get-minecraft-server.query";
import { MinecraftServerAlreadyExistsError } from "../../src/modules/minecraft/domain/errors/minecraft-server-already-exists.error";
import { MinecraftServerNotFoundError } from "../../src/modules/minecraft/domain/errors/minecraft-server-not-found.error";
import { MinecraftServerNotRunningError } from "../../src/modules/minecraft/domain/errors/minecraft-server-not-running.error";
import { noopLogger } from "../../src/shared/observability/logger.port";
import type { MinecraftServer } from "../../src/modules/minecraft/domain/types/minecraft-server";

describe("minecraft module", () => {
  let pidDir: string;
  let dataDir: string;
  let serverProcess: BunServerProcessAdapter;
  let serverRegistry: InMemoryServerRegistryAdapter;
  let minecraftRepository: JsonMinecraftServerRepositoryAdapter;
  let minecraftStdin: BunMinecraftStdinAdapter;
  let minecraftLog: BunMinecraftLogAdapter;
  let createHandler: CreateMinecraftServerHandler;
  let startHandler: StartMinecraftServerHandler;
  let stopHandler: StopMinecraftServerHandler;
  let deleteHandler: DeleteMinecraftServerHandler;
  let sendCommandHandler: SendMinecraftCommandHandler;
  let listHandler: ListMinecraftServersHandler;
  let getHandler: GetMinecraftServerHandler;

  const testServer: MinecraftServer = {
    id: "test-vanilla",
    name: "Test Vanilla",
    directory: "E:/vanilla",
    javaPath: "java",
    jarFile: "server.jar",
    jvmArgs: ["-Xmx2G", "-Xms2G"],
    serverArgs: ["--nogui"],
  };

  // For start/stop tests, we bypass the start handler's arg construction
  // and spawn directly via the server module, then test minecraft-level logic.
  // This avoids needing a real Java installation in the test environment.
  const longRunningServer: MinecraftServer = {
    id: "long-running",
    name: "Long Running",
    directory: ".",
    javaPath: process.execPath,
    jarFile: "server.jar",
    jvmArgs: ["-e", "setTimeout(() => {}, 60000)"],
    serverArgs: ["--nogui"],
  };

  beforeEach(async () => {
    pidDir = await mkdtemp(path.join(os.tmpdir(), "minecraft-module-pids-"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "minecraft-module-data-"));
    serverProcess = new BunServerProcessAdapter(noopLogger, pidDir, new EventBus());
    serverRegistry = new InMemoryServerRegistryAdapter();
    minecraftRepository = new JsonMinecraftServerRepositoryAdapter(noopLogger, dataDir);
    minecraftStdin = new BunMinecraftStdinAdapter(serverProcess);
    minecraftLog = new BunMinecraftLogAdapter(serverProcess, noopLogger);
    const minecraftWaitForExit = waitForProcessExit(serverProcess);
    const noopPatternRegistry = new InMemoryPatternRegistryAdapter();
    const noopLogListener = new MinecraftLogListener(minecraftLog, noopPatternRegistry, new EventBus(), minecraftRepository, noopLogger);
    // Use a short timeout for tests since test processes don't respond to /stop
    const testWaitForExit = (instanceId: string, _timeoutMs: number) =>
      minecraftWaitForExit(instanceId, 500);
    const testCommandBus = new CommandBus();
    const STOP_MINECRAFT_SERVER_COMMAND = "minecraft.server.stop";
    testCommandBus.register(STOP_MINECRAFT_SERVER_COMMAND, new StopMinecraftServerHandler(minecraftRepository, serverProcess, serverRegistry, minecraftStdin, testWaitForExit, noopLogListener));
    createHandler = new CreateMinecraftServerHandler(minecraftRepository);
    startHandler = new StartMinecraftServerHandler(minecraftRepository, serverProcess, serverRegistry, noopLogListener);
    stopHandler = new StopMinecraftServerHandler(minecraftRepository, serverProcess, serverRegistry, minecraftStdin, testWaitForExit, noopLogListener);
    deleteHandler = new DeleteMinecraftServerHandler(minecraftRepository, testCommandBus);
    sendCommandHandler = new SendMinecraftCommandHandler(minecraftRepository, serverRegistry, minecraftStdin);
    listHandler = new ListMinecraftServersHandler(minecraftRepository);
    getHandler = new GetMinecraftServerHandler(minecraftRepository, serverRegistry);
  });

  afterEach(async () => {
    // Kill any remaining tracked processes
    const instances = await serverRegistry.list();
    for (const instance of instances) {
      try {
        await serverProcess.kill(instance.id);
      } catch {
        // Best effort cleanup
      }
    }
    await rm(pidDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  // --- Create ---

  test("creates a minecraft server definition and persists it", async () => {
    const server = await createHandler.handle(new CreateMinecraftServerCommand(testServer));
    expect(server.id).toBe("test-vanilla");
    expect(server.name).toBe("Test Vanilla");

    const loaded = await minecraftRepository.get("test-vanilla");
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe("test-vanilla");
  });

  test("rejects creating a server with duplicate ID", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));
    await expect(
      createHandler.handle(new CreateMinecraftServerCommand(testServer)),
    ).rejects.toThrow(MinecraftServerAlreadyExistsError);
  });

  // --- List ---

  test("lists all minecraft servers", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));
    await createHandler.handle(new CreateMinecraftServerCommand({
      ...longRunningServer,
      id: "another-server",
      name: "Another Server",
    }));

    const servers = await listHandler.handle(new ListMinecraftServersQuery());
    expect(servers).toHaveLength(2);
    expect(servers.map((s) => s.id).sort()).toEqual(["another-server", "test-vanilla"]);
  });

  // --- Get ---

  test("gets server details with stopped status when not running", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));

    const details = await getHandler.handle(new GetMinecraftServerQuery("test-vanilla"));
    expect(details.id).toBe("test-vanilla");
    expect(details.status).toBe("stopped");
    expect(details.pid).toBeUndefined();
  });

  test("gets server details with running status when started", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(longRunningServer));
    const instance = await serverProcess.spawn({
      id: "long-running",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ".",
    });
    await serverRegistry.register(instance);

    const details = await getHandler.handle(new GetMinecraftServerQuery("long-running"));
    expect(details.id).toBe("long-running");
    expect(details.status).toBe("running");
    expect(details.pid).toBeGreaterThan(0);
  });

  test("get throws MinecraftServerNotFoundError for unknown server", async () => {
    await expect(
      getHandler.handle(new GetMinecraftServerQuery("nonexistent")),
    ).rejects.toThrow(MinecraftServerNotFoundError);
  });

  // --- Start ---

  test("starts a minecraft server process by spawning directly", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(longRunningServer));
    // Spawn directly via server module since we can't use real Java in tests
    const instance = await serverProcess.spawn({
      id: "long-running",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ".",
    });
    await serverRegistry.register(instance);

    expect(instance.id).toBe("long-running");
    expect(instance.pid).toBeGreaterThan(0);
    expect(instance.status).toBe("running");
  });

  test("start throws MinecraftServerNotFoundError for unknown server", async () => {
    await expect(
      startHandler.handle(new StartMinecraftServerCommand("nonexistent")),
    ).rejects.toThrow(MinecraftServerNotFoundError);
  });

  test("start throws ServerAlreadyExistsError when server is already running", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(longRunningServer));
    const instance = await serverProcess.spawn({
      id: "long-running",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ".",
    });
    await serverRegistry.register(instance);

    await expect(
      startHandler.handle(new StartMinecraftServerCommand("long-running")),
    ).rejects.toThrow();
  });

  // --- Stop ---

  test("stops a running minecraft server", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(longRunningServer));
    const instance = await serverProcess.spawn({
      id: "long-running",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ".",
    });
    await serverRegistry.register(instance);

    await stopHandler.handle(new StopMinecraftServerCommand("long-running"));

    const details = await getHandler.handle(new GetMinecraftServerQuery("long-running"));
    expect(details.status).toBe("stopped");
  });

  test("stop throws MinecraftServerNotFoundError for unknown server", async () => {
    await expect(
      stopHandler.handle(new StopMinecraftServerCommand("nonexistent")),
    ).rejects.toThrow(MinecraftServerNotFoundError);
  });

  // --- Delete ---

  test("deletes a minecraft server definition (stops if running)", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(longRunningServer));
    const instance = await serverProcess.spawn({
      id: "long-running",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ".",
    });
    await serverRegistry.register(instance);

    await deleteHandler.handle(new DeleteMinecraftServerCommand("long-running"));

    await expect(minecraftRepository.get("long-running")).resolves.toBeUndefined();
  });

  test("deletes a stopped minecraft server definition", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));
    await deleteHandler.handle(new DeleteMinecraftServerCommand("test-vanilla"));

    await expect(minecraftRepository.get("test-vanilla")).resolves.toBeUndefined();
  });

  test("delete throws MinecraftServerNotFoundError for unknown server", async () => {
    await expect(
      deleteHandler.handle(new DeleteMinecraftServerCommand("nonexistent")),
    ).rejects.toThrow(MinecraftServerNotFoundError);
  });

  // --- Send Command ---

  test("send command throws MinecraftServerNotRunningError when server is stopped", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));

    await expect(
      sendCommandHandler.handle(new SendMinecraftCommandCommand("test-vanilla", "say hello")),
    ).rejects.toThrow(MinecraftServerNotRunningError);
  });

  test("send command throws MinecraftServerNotFoundError for unknown server", async () => {
    await expect(
      sendCommandHandler.handle(new SendMinecraftCommandCommand("nonexistent", "say hello")),
    ).rejects.toThrow(MinecraftServerNotFoundError);
  });

  // --- Persistence ---

  test("servers persist across repository reload", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));

    // Create a new repository instance pointing to the same data dir
    const freshRepository = new JsonMinecraftServerRepositoryAdapter(noopLogger, dataDir);
    const loaded = await freshRepository.get("test-vanilla");
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe("test-vanilla");
    expect(loaded!.name).toBe("Test Vanilla");
  });

  test("persistence file is valid JSON", async () => {
    await createHandler.handle(new CreateMinecraftServerCommand(testServer));

    const filePath = path.join(dataDir, "minecraft", "servers.json");
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0].id).toBe("test-vanilla");
  });

  // --- HTTP Routes ---

  test("minecraft routes return correct JSON for create and list", async () => {
    const pidDir2 = await mkdtemp(path.join(os.tmpdir(), "minecraft-http-pids-"));
    const dataDir2 = await mkdtemp(path.join(os.tmpdir(), "minecraft-http-data-"));
    const sp = new BunServerProcessAdapter(noopLogger, pidDir2, new EventBus());
    const sr = new InMemoryServerRegistryAdapter();
    const mr = new JsonMinecraftServerRepositoryAdapter(noopLogger, dataDir2);
    const ms = new BunMinecraftStdinAdapter(sp);
    const ml = new BunMinecraftLogAdapter(sp, noopLogger);
    const noopPr = new InMemoryPatternRegistryAdapter();
    const noopLl = new MinecraftLogListener(ml, noopPr, new EventBus(), mr, noopLogger);

    const { CommandBus } = await import("../../src/shared/application/command-bus");
    const { QueryBus } = await import("../../src/shared/application/query-bus");
    const commandBus = new CommandBus();
    const queryBus = new QueryBus();

    const { CREATE_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/create-minecraft-server.command");
    const { START_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/start-minecraft-server.command");
    const { STOP_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/stop-minecraft-server.command");
    const { DELETE_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/delete-minecraft-server.command");
    const { SEND_MINECRAFT_COMMAND_COMMAND } = await import("../../src/modules/minecraft/application/commands/send-minecraft-command.command");
    const { LIST_MINECRAFT_SERVERS_QUERY } = await import("../../src/modules/minecraft/application/queries/list-minecraft-servers.query");
    const { GET_MINECRAFT_SERVER_QUERY } = await import("../../src/modules/minecraft/application/queries/get-minecraft-server.query");
    const { STREAM_MINECRAFT_LOGS_QUERY } = await import("../../src/modules/minecraft/application/queries/stream-minecraft-logs.query");
    const { StreamMinecraftLogsHandler } = await import("../../src/modules/minecraft/application/queries/stream-minecraft-logs.handler");
    const { SpawnServerHandler } = await import("../../src/modules/server/application/commands/spawn-server.handler");
    const { KillServerHandler } = await import("../../src/modules/server/application/commands/kill-server.handler");
    const { SPAWN_SERVER_COMMAND } = await import("../../src/modules/server/application/commands/spawn-server.command");
    const { KILL_SERVER_COMMAND } = await import("../../src/modules/server/application/commands/kill-server.command");
    const { ListServersHandler } = await import("../../src/modules/server/application/queries/list-servers.handler");
    const { GetServerStatusHandler } = await import("../../src/modules/server/application/queries/get-server-status.handler");
    const { LIST_SERVERS_QUERY } = await import("../../src/modules/server/application/queries/list-servers.query");
    const { GET_SERVER_STATUS_QUERY } = await import("../../src/modules/server/application/queries/get-server-status.query");

    commandBus.register(SPAWN_SERVER_COMMAND, new SpawnServerHandler(sp, sr));
    commandBus.register(KILL_SERVER_COMMAND, new KillServerHandler(sp, sr));
    commandBus.register(CREATE_MINECRAFT_SERVER_COMMAND, new CreateMinecraftServerHandler(mr));
    commandBus.register(START_MINECRAFT_SERVER_COMMAND, new StartMinecraftServerHandler(mr, sp, sr, noopLl));
    commandBus.register(STOP_MINECRAFT_SERVER_COMMAND, new StopMinecraftServerHandler(mr, sp, sr, ms, ((id: string, _ms: number) => waitForProcessExit(sp)(id, 500)), noopLl));
    commandBus.register(DELETE_MINECRAFT_SERVER_COMMAND, new DeleteMinecraftServerHandler(mr, commandBus));
    commandBus.register(SEND_MINECRAFT_COMMAND_COMMAND, new SendMinecraftCommandHandler(mr, sr, ms));

    queryBus.register(LIST_SERVERS_QUERY, new ListServersHandler(sr));
    queryBus.register(GET_SERVER_STATUS_QUERY, new GetServerStatusHandler(sr));
    queryBus.register(LIST_MINECRAFT_SERVERS_QUERY, new ListMinecraftServersHandler(mr));
    queryBus.register(GET_MINECRAFT_SERVER_QUERY, new GetMinecraftServerHandler(mr, sr));
    queryBus.register(STREAM_MINECRAFT_LOGS_QUERY, new StreamMinecraftLogsHandler(mr, sr, ml));

    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerMinecraftRoutes(router, commandBus, queryBus, testGuard, noopLogger);

    const token = await new SignJWT({ scope: `${SCOPES.SERVER_READ} ${SCOPES.SERVER_WRITE}` })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    // Create a server
    const createResponse = await router.handle(new Request("http://localhost/minecraft/servers", {
      method: "POST",
      body: JSON.stringify({
        id: "http-test",
        name: "HTTP Test Server",
        directory: ".",
        javaPath: "java",
        jarFile: "server.jar",
        jvmArgs: ["-Xmx2G"],
        serverArgs: ["--nogui"],
      }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(createResponse.status).toBe(201);
    const createBody = await createResponse.json() as { id: string; name: string; serverArgs: string[] };
    expect(createBody.id).toBe("http-test");
    expect(createBody.name).toBe("HTTP Test Server");
    expect(createBody.serverArgs).toEqual(["--nogui"]);

    // List servers
    const listResponse = await router.handle(new Request("http://localhost/minecraft/servers", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { servers: Array<{ id: string }> };
    expect(listBody.servers.some((s) => s.id === "http-test")).toBe(true);

    // Get server details (stopped)
    const getResponse = await router.handle(new Request("http://localhost/minecraft/servers/http-test", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json() as { id: string; status: string };
    expect(getBody.id).toBe("http-test");
    expect(getBody.status).toBe("stopped");

    // Spawn a process directly via the server module (bypasses start handler's Java arg construction)
    const instance = await sp.spawn({
      id: "http-test",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
      cwd: ".",
    });
    await sr.register(instance);

    // Get server details (now running)
    const getRunningResponse = await router.handle(new Request("http://localhost/minecraft/servers/http-test", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(getRunningResponse.status).toBe(200);
    const getRunningBody = await getRunningResponse.json() as { id: string; status: string };
    expect(getRunningBody.status).toBe("running");

    // Stop server
    const stopResponse = await router.handle(new Request("http://localhost/minecraft/servers/http-test/stop", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(stopResponse.status).toBe(200);

    // Delete server
    const deleteResponse = await router.handle(new Request("http://localhost/minecraft/servers/http-test", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(deleteResponse.status).toBe(200);

    // Cleanup
    await rm(pidDir2, { recursive: true, force: true });
    await rm(dataDir2, { recursive: true, force: true });
  });

  test("minecraft routes reject requests without a valid JWT", async () => {
    const { CommandBus } = await import("../../src/shared/application/command-bus");
    const { QueryBus } = await import("../../src/shared/application/query-bus");
    const router = new Router();
    const testGuard = new JwtGuard({ secret: "test-secret-key-for-unit-tests", issuer: undefined, audience: undefined });
    registerMinecraftRoutes(router, new CommandBus(), new QueryBus(), testGuard, noopLogger);

    const noTokenResponse = await router.handle(new Request("http://localhost/minecraft/servers", {
      method: "POST",
      body: JSON.stringify({ id: "test", name: "Test", directory: ".", javaPath: "java", jarFile: "server.jar" }),
      headers: { "content-type": "application/json" },
    }));

    expect(noTokenResponse.status).toBe(401);
  });

  test("minecraft routes reject requests with insufficient scope", async () => {
    const { CommandBus } = await import("../../src/shared/application/command-bus");
    const { QueryBus } = await import("../../src/shared/application/query-bus");
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerMinecraftRoutes(router, new CommandBus(), new QueryBus(), testGuard, noopLogger);

    const readOnlyToken = await new SignJWT({ scope: SCOPES.SERVER_READ })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const insufficientResponse = await router.handle(new Request("http://localhost/minecraft/servers", {
      method: "POST",
      body: JSON.stringify({ id: "test", name: "Test", directory: ".", javaPath: "java", jarFile: "server.jar" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${readOnlyToken}` },
    }));

    expect(insufficientResponse.status).toBe(403);
    const body = await insufficientResponse.json() as { error: string; required: string };
    expect(body.error).toBe("Insufficient scope");
    expect(body.required).toBe(SCOPES.SERVER_WRITE);
  });

  test("minecraft routes return 404 for unknown server", async () => {
    const pidDir2 = await mkdtemp(path.join(os.tmpdir(), "minecraft-404-pids-"));
    const dataDir2 = await mkdtemp(path.join(os.tmpdir(), "minecraft-404-data-"));
    const sp = new BunServerProcessAdapter(noopLogger, pidDir2, new EventBus());
    const sr = new InMemoryServerRegistryAdapter();
    const mr = new JsonMinecraftServerRepositoryAdapter(noopLogger, dataDir2);

    const { CommandBus } = await import("../../src/shared/application/command-bus");
    const { QueryBus } = await import("../../src/shared/application/query-bus");
    const commandBus = new CommandBus();
    const queryBus = new QueryBus();

    const { SPAWN_SERVER_COMMAND } = await import("../../src/modules/server/application/commands/spawn-server.command");
    const { KILL_SERVER_COMMAND } = await import("../../src/modules/server/application/commands/kill-server.command");
    const { LIST_SERVERS_QUERY } = await import("../../src/modules/server/application/queries/list-servers.query");
    const { GET_SERVER_STATUS_QUERY } = await import("../../src/modules/server/application/queries/get-server-status.query");
    const { SpawnServerHandler } = await import("../../src/modules/server/application/commands/spawn-server.handler");
    const { KillServerHandler } = await import("../../src/modules/server/application/commands/kill-server.handler");
    const { ListServersHandler } = await import("../../src/modules/server/application/queries/list-servers.handler");
    const { GetServerStatusHandler } = await import("../../src/modules/server/application/queries/get-server-status.handler");
    const { CREATE_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/create-minecraft-server.command");
    const { START_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/start-minecraft-server.command");
    const { STOP_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/stop-minecraft-server.command");
    const { DELETE_MINECRAFT_SERVER_COMMAND } = await import("../../src/modules/minecraft/application/commands/delete-minecraft-server.command");
    const { SEND_MINECRAFT_COMMAND_COMMAND } = await import("../../src/modules/minecraft/application/commands/send-minecraft-command.command");
    const { LIST_MINECRAFT_SERVERS_QUERY } = await import("../../src/modules/minecraft/application/queries/list-minecraft-servers.query");
    const { GET_MINECRAFT_SERVER_QUERY } = await import("../../src/modules/minecraft/application/queries/get-minecraft-server.query");
    const { STREAM_MINECRAFT_LOGS_QUERY } = await import("../../src/modules/minecraft/application/queries/stream-minecraft-logs.query");
    const { StreamMinecraftLogsHandler } = await import("../../src/modules/minecraft/application/queries/stream-minecraft-logs.handler");
    const { BunMinecraftStdinAdapter } = await import("../../src/modules/minecraft/infrastructure/process/bun-minecraft-stdin.adapter");
    const { BunMinecraftLogAdapter } = await import("../../src/modules/minecraft/infrastructure/process/bun-minecraft-log.adapter");

    const ms = new BunMinecraftStdinAdapter(sp);
    const ml = new BunMinecraftLogAdapter(sp, noopLogger);
    const noopPr2 = new InMemoryPatternRegistryAdapter();
    const noopLl2 = new MinecraftLogListener(ml, noopPr2, new EventBus(), mr, noopLogger);

    commandBus.register(SPAWN_SERVER_COMMAND, new SpawnServerHandler(sp, sr));
    commandBus.register(KILL_SERVER_COMMAND, new KillServerHandler(sp, sr));
    commandBus.register(CREATE_MINECRAFT_SERVER_COMMAND, new CreateMinecraftServerHandler(mr));
    commandBus.register(START_MINECRAFT_SERVER_COMMAND, new StartMinecraftServerHandler(mr, sp, sr, noopLl2));
    commandBus.register(STOP_MINECRAFT_SERVER_COMMAND, new StopMinecraftServerHandler(mr, sp, sr, ms, ((id: string, _ms: number) => waitForProcessExit(sp)(id, 500)), noopLl2));
    commandBus.register(DELETE_MINECRAFT_SERVER_COMMAND, new DeleteMinecraftServerHandler(mr, commandBus));
    commandBus.register(SEND_MINECRAFT_COMMAND_COMMAND, new SendMinecraftCommandHandler(mr, sr, ms));

    queryBus.register(LIST_SERVERS_QUERY, new ListServersHandler(sr));
    queryBus.register(GET_SERVER_STATUS_QUERY, new GetServerStatusHandler(sr));
    queryBus.register(LIST_MINECRAFT_SERVERS_QUERY, new ListMinecraftServersHandler(mr));
    queryBus.register(GET_MINECRAFT_SERVER_QUERY, new GetMinecraftServerHandler(mr, sr));
    queryBus.register(STREAM_MINECRAFT_LOGS_QUERY, new StreamMinecraftLogsHandler(mr, sr, ml));

    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerMinecraftRoutes(router, commandBus, queryBus, testGuard, noopLogger);

    const token = await new SignJWT({ scope: SCOPES.SERVER_READ })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const getResponse = await router.handle(new Request("http://localhost/minecraft/servers/nonexistent", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(getResponse.status).toBe(404);
    const body = await getResponse.json() as { error: string };
    expect(body.error).toBe("MinecraftServerNotFound");

    await rm(pidDir2, { recursive: true, force: true });
    await rm(dataDir2, { recursive: true, force: true });
  });
});
