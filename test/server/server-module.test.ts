import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { createContainer } from "../../src/bootstrap/container";
import { Router } from "../../src/shared/http/router";
import { JwtGuard } from "../../src/shared/http/jwt-guard";
import { registerServerRoutes } from "../../src/modules/server/infrastructure/http/server-routes";
import { SCOPES } from "../../src/modules/server/infrastructure/http/scopes";
import { BunServerProcessAdapter } from "../../src/modules/server/infrastructure/process/bun-server-process.adapter";
import { InMemoryServerRegistryAdapter } from "../../src/modules/server/infrastructure/registry/in-memory-server-registry.adapter";
import { EventBus } from "../../src/shared/application/event-bus";
import { SpawnServerHandler } from "../../src/modules/server/application/commands/spawn-server.handler";
import { KillServerHandler } from "../../src/modules/server/application/commands/kill-server.handler";
import { ListServersHandler } from "../../src/modules/server/application/queries/list-servers.handler";
import { GetServerStatusHandler } from "../../src/modules/server/application/queries/get-server-status.handler";
import { SPAWN_SERVER_COMMAND } from "../../src/modules/server/application/commands/spawn-server.command";
import { KILL_SERVER_COMMAND } from "../../src/modules/server/application/commands/kill-server.command";
import { LIST_SERVERS_QUERY } from "../../src/modules/server/application/queries/list-servers.query";
import { GET_SERVER_STATUS_QUERY } from "../../src/modules/server/application/queries/get-server-status.query";
import { SpawnServerCommand } from "../../src/modules/server/application/commands/spawn-server.command";
import { KillServerCommand } from "../../src/modules/server/application/commands/kill-server.command";
import { ListServersQuery } from "../../src/modules/server/application/queries/list-servers.query";
import { GetServerStatusQuery } from "../../src/modules/server/application/queries/get-server-status.query";
import { ServerNotFoundError } from "../../src/modules/server/domain/errors/server-not-found.error";
import { ServerAlreadyExistsError } from "../../src/modules/server/domain/errors/server-already-exists.error";
import { noopLogger } from "../../src/shared/observability/logger.port";

describe("server module", () => {
  let pidDir: string;
  let serverProcess: BunServerProcessAdapter;
  let serverRegistry: InMemoryServerRegistryAdapter;
  let spawnHandler: SpawnServerHandler;
  let killHandler: KillServerHandler;
  let listHandler: ListServersHandler;
  let statusHandler: GetServerStatusHandler;

  beforeEach(async () => {
    pidDir = await mkdtemp(path.join(os.tmpdir(), "server-module-pids-"));
    serverProcess = new BunServerProcessAdapter(noopLogger, pidDir, new EventBus());
    serverRegistry = new InMemoryServerRegistryAdapter();
    spawnHandler = new SpawnServerHandler(serverProcess, serverRegistry);
    killHandler = new KillServerHandler(serverProcess, serverRegistry);
    listHandler = new ListServersHandler(serverRegistry);
    statusHandler = new GetServerStatusHandler(serverRegistry);
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
  });

  test("spawns a server instance and tracks it in registry", async () => {
    const instance = await spawnHandler.handle(
      new SpawnServerCommand({
        id: "test-server",
        command: process.execPath,
        args: ["--version"],
      }),
    );

    expect(instance.id).toBe("test-server");
    expect(instance.pid).toBeGreaterThan(0);
    expect(instance.command).toBe(process.execPath);
    expect(instance.status).toBe("running");
    expect(instance.startedAt).toBeInstanceOf(Date);

    const registered = await serverRegistry.get("test-server");
    expect(registered).toBeDefined();
    expect(registered!.id).toBe("test-server");
  });

  test("writes PID file on spawn", async () => {
    await spawnHandler.handle(
      new SpawnServerCommand({
        id: "pid-test",
        command: process.execPath,
        args: ["--version"],
      }),
    );

    const pidFile = path.join(pidDir, "pid-test.pid");
    const content = await readFile(pidFile, "utf8");
    expect(Number(content.trim())).toBeGreaterThan(0);
  });

  test("rejects duplicate instance ID", async () => {
    await spawnHandler.handle(
      new SpawnServerCommand({
        id: "duplicate-test",
        command: process.execPath,
        args: ["--version"],
      }),
    );

    await expect(
      spawnHandler.handle(
        new SpawnServerCommand({
          id: "duplicate-test",
          command: process.execPath,
          args: ["--version"],
        }),
      ),
    ).rejects.toThrow(ServerAlreadyExistsError);
  });

  test("kills a running instance and removes PID file", async () => {
    // Spawn a long-running process
    const instance = await spawnHandler.handle(
      new SpawnServerCommand({
        id: "kill-test",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
      }),
    );

    expect(instance.status).toBe("running");

    await killHandler.handle(new KillServerCommand("kill-test"));

    const registered = await serverRegistry.get("kill-test");
    expect(registered).toBeUndefined();

    // PID file should be removed
    const pidFile = path.join(pidDir, "kill-test.pid");
    await expect(readFile(pidFile, "utf8")).rejects.toThrow();
  });

  test("kill throws ServerNotFoundError for unknown instance", async () => {
    await expect(
      killHandler.handle(new KillServerCommand("nonexistent")),
    ).rejects.toThrow(ServerNotFoundError);
  });

  test("lists all registered instances", async () => {
    await spawnHandler.handle(
      new SpawnServerCommand({
        id: "list-1",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
      }),
    );
    await spawnHandler.handle(
      new SpawnServerCommand({
        id: "list-2",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
      }),
    );

    const instances = await listHandler.handle(new ListServersQuery());
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.id).sort()).toEqual(["list-1", "list-2"]);
  });

  test("gets status of a running instance", async () => {
    await spawnHandler.handle(
      new SpawnServerCommand({
        id: "status-test",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
      }),
    );

    const instance = await statusHandler.handle(new GetServerStatusQuery("status-test"));
    expect(instance.id).toBe("status-test");
    expect(instance.status).toBe("running");
  });

  test("status throws ServerNotFoundError for unknown instance", async () => {
    await expect(
      statusHandler.handle(new GetServerStatusQuery("nonexistent")),
    ).rejects.toThrow(ServerNotFoundError);
  });

  test("reconcile adopts running processes from PID files", async () => {
    // Simulate a PID file from a previous app run
    const realProcess = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 60000)"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const pid = realProcess.pid;

    await mkdir(pidDir, { recursive: true });
    await writeFile(path.join(pidDir, "reconcile-test.pid"), String(pid), "utf8");

    // Create a fresh adapter and registry (simulating app restart)
    const freshProcess = new BunServerProcessAdapter(noopLogger, pidDir, new EventBus());
    const freshRegistry = new InMemoryServerRegistryAdapter();

    await freshProcess.reconcile(freshRegistry);

    const instance = await freshRegistry.get("reconcile-test");
    expect(instance).toBeDefined();
    expect(instance!.id).toBe("reconcile-test");
    expect(instance!.pid).toBe(pid);
    expect(instance!.status).toBe("running");

    // Cleanup
    realProcess.kill();
    await realProcess.exited;
  });

  test("reconcile removes stale PID files for dead processes", async () => {
    // Create a PID file with a PID that doesn't exist
    await mkdir(pidDir, { recursive: true });
    const stalePidFile = path.join(pidDir, "stale-test.pid");
    await writeFile(stalePidFile, "999999999", "utf8"); // Very unlikely to be a real PID

    const freshProcess = new BunServerProcessAdapter(noopLogger, pidDir, new EventBus());
    const freshRegistry = new InMemoryServerRegistryAdapter();

    await freshProcess.reconcile(freshRegistry);

    const instance = await freshRegistry.get("stale-test");
    expect(instance).toBeUndefined();

    // PID file should be removed
    await expect(readFile(stalePidFile, "utf8")).rejects.toThrow();
  });

  test("server routes return correct JSON for spawn and list", async () => {
    const container = await createContainer();
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerServerRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const token = await new SignJWT({ scope: `${SCOPES.INSTANCE_READ} ${SCOPES.INSTANCE_WRITE}` })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    // Spawn an instance
    const spawnResponse = await router.handle(new Request("http://localhost/server/instances", {
      method: "POST",
      body: JSON.stringify({
        id: "http-test",
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 60000)"],
      }),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));

    expect(spawnResponse.status).toBe(201);
    const spawnBody = await spawnResponse.json() as { id: string; status: string };
    expect(spawnBody.id).toBe("http-test");
    expect(spawnBody.status).toBe("running");

    // List instances
    const listResponse = await router.handle(new Request("http://localhost/server/instances", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as { instances: Array<{ id: string }> };
    expect(listBody.instances.some((i) => i.id === "http-test")).toBe(true);

    // Get status
    const statusResponse = await router.handle(new Request("http://localhost/server/instances/http-test", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(statusResponse.status).toBe(200);
    const statusBody = await statusResponse.json() as { id: string; status: string };
    expect(statusBody.id).toBe("http-test");

    // Kill instance
    const killResponse = await router.handle(new Request("http://localhost/server/instances/http-test", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(killResponse.status).toBe(200);
    const killBody = await killResponse.json() as { ok: boolean };
    expect(killBody.ok).toBe(true);
  });

  test("server routes reject requests without a valid JWT", async () => {
    const container = await createContainer();
    const router = new Router();
    const testGuard = new JwtGuard({ secret: "test-secret-key-for-unit-tests", issuer: undefined, audience: undefined });
    registerServerRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const noTokenResponse = await router.handle(new Request("http://localhost/server/instances", {
      method: "POST",
      body: JSON.stringify({ id: "test", command: "echo" }),
      headers: { "content-type": "application/json" },
    }));

    expect(noTokenResponse.status).toBe(401);
  });

  test("server routes reject requests with insufficient scope", async () => {
    const container = await createContainer();
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerServerRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const readOnlyToken = await new SignJWT({ scope: SCOPES.INSTANCE_READ })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const insufficientResponse = await router.handle(new Request("http://localhost/server/instances", {
      method: "POST",
      body: JSON.stringify({ id: "test", command: "echo" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${readOnlyToken}` },
    }));

    expect(insufficientResponse.status).toBe(403);
    const body = await insufficientResponse.json() as { error: string; required: string };
    expect(body.error).toBe("Insufficient scope");
    expect(body.required).toBe(SCOPES.INSTANCE_WRITE);
  });

  test("server routes return 404 for unknown instance status", async () => {
    const container = await createContainer();
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerServerRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const token = await new SignJWT({ scope: SCOPES.INSTANCE_READ })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const statusResponse = await router.handle(new Request("http://localhost/server/instances/nonexistent", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(statusResponse.status).toBe(404);
    const body = await statusResponse.json() as { error: string };
    expect(body.error).toBe("ServerNotFound");
  });

  test("server routes return 409 for duplicate instance ID", async () => {
    const container = await createContainer();
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerServerRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const token = await new SignJWT({ scope: `${SCOPES.INSTANCE_READ} ${SCOPES.INSTANCE_WRITE}` })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const body = JSON.stringify({
      id: "dup-test",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"],
    });

    // First spawn should succeed
    const first = await router.handle(new Request("http://localhost/server/instances", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));
    expect(first.status).toBe(201);

    // Second spawn with same ID should fail
    const second = await router.handle(new Request("http://localhost/server/instances", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));
    expect(second.status).toBe(409);
    const errorBody = await second.json() as { error: string };
    expect(errorBody.error).toBe("ServerAlreadyExists");

    // Cleanup
    const instance = await first.json() as { id: string };
    await router.handle(new Request(`http://localhost/server/instances/${instance.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }));
  });
});
