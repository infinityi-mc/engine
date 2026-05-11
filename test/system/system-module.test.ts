import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { createContainer } from "../../src/bootstrap/container";
import { Router } from "../../src/shared/http/router";
import { JwtGuard } from "../../src/shared/http/jwt-guard";
import { registerSystemRoutes } from "../../src/modules/system/infrastructure/http/system-routes";
import { SCOPES } from "../../src/modules/system/infrastructure/http/scopes";
import { NodeSystemFilesAdapter } from "../../src/modules/system/infrastructure/filesystem/node-system-files.adapter";
import { BunTerminalAdapter } from "../../src/modules/system/infrastructure/terminal/bun-terminal.adapter";

const awkTest = await isToolAvailable("awk") ? test : test.skip;
const sedTest = await isToolAvailable("sed") ? test : test.skip;

describe("system module", () => {
  let directory: string;
  let terminal: BunTerminalAdapter;
  let systemFiles: NodeSystemFilesAdapter;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "system-module-"));
    terminal = new BunTerminalAdapter();
    systemFiles = new NodeSystemFilesAdapter(terminal);

    await writeFile(path.join(directory, "alpha.txt"), "hello world\nsecond line\n", "utf8");
    await writeFile(path.join(directory, "beta.md"), "hello markdown\n", "utf8");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("discovers files with glob, grep, listDir, and readFile", async () => {
    const globMatches = await systemFiles.glob({ pattern: "*.txt", cwd: directory });
    const grepMatches = await systemFiles.grep({ pattern: "world", path: directory, include: "*.txt" });
    const entries = await systemFiles.listDir(directory);
    const file = await systemFiles.readFile({ path: path.join(directory, "alpha.txt") });

    expect(globMatches).toContain("alpha.txt");
    expect(grepMatches).toHaveLength(1);
    expect(grepMatches[0]?.lineNumber).toBe(1);
    expect(entries.some((entry) => entry.name === "alpha.txt" && entry.type === "file")).toBe(true);
    expect(file.content).toContain("hello world");
  });

  test("applies glob limits and returns all grep matches per line", async () => {
    await writeFile(path.join(directory, "many.txt"), "one one one\n", "utf8");

    const globMatches = await systemFiles.glob({ pattern: "*.*", cwd: directory, maxResults: 1 });
    const grepMatches = await systemFiles.grep({ pattern: "one", path: path.join(directory, "many.txt") });

    expect(globMatches).toHaveLength(1);
    expect(grepMatches).toHaveLength(3);
    expect(grepMatches.map((match) => match.column)).toEqual([1, 5, 9]);
  });

  test("rejects unsafe grep patterns", async () => {
    await expect(systemFiles.grep({ pattern: "(a+)+$", path: directory })).rejects.toThrow(
      "unsafe nested quantifier",
    );
  });

  test("copies, moves, and deletes paths", async () => {
    const source = path.join(directory, "alpha.txt");
    const copy = path.join(directory, "copy.txt");
    const moved = path.join(directory, "moved.txt");

    await systemFiles.copy(source, copy);
    await systemFiles.move(copy, moved);
    await systemFiles.delete(moved);

    expect(await readFile(source, "utf8")).toContain("hello world");
    await expect(readFile(moved, "utf8")).rejects.toThrow();
  });

  test("executes terminal commands", async () => {
    const result = await terminal.execute({ command: process.execPath, args: ["--version"], timeoutMs: 10_000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  test("merges custom terminal env with host env for command resolution", async () => {
    const result = await terminal.execute({ command: "bun", args: ["--version"], env: { CUSTOM_ENV: "x" }, timeoutMs: 10_000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  awkTest("uses real awk when available", async () => {
    const result = await systemFiles.awk({ program: "{ print $1 }", input: "one two\n", timeoutMs: 10_000 });

    expect(result.command).toBe("awk");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("one");
  });

  sedTest("uses real sed when available", async () => {
    const result = await systemFiles.sed({ script: "s/one/two/", input: "one\n", timeoutMs: 10_000 });

    expect(result.command).toBe("sed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("two");
  });

  test("system routes return clear JSON errors for invalid bodies and methods", async () => {
    const container = await createContainer();
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerSystemRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const token = await new SignJWT({ scope: `${SCOPES.FILES_READ} ${SCOPES.FILES_WRITE} ${SCOPES.TERMINAL_EXECUTE}` })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const invalidJsonResponse = await router.handle(new Request("http://localhost/system/files/glob", {
      method: "POST",
      body: "{invalid",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    }));
    const methodResponse = await router.handle(new Request("http://localhost/system/files/glob", { method: "GET" }));

    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.json()).toEqual({ error: "Invalid JSON body" });
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("allow")).toBe("POST");
    expect(await methodResponse.json()).toEqual({ error: "Method Not Allowed" });
  });

  test("system routes reject requests without a valid JWT", async () => {
    const container = await createContainer();
    const router = new Router();
    const testGuard = new JwtGuard({ secret: "test-secret-key-for-unit-tests", issuer: undefined, audience: undefined });
    registerSystemRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const noTokenResponse = await router.handle(new Request("http://localhost/system/files/glob", {
      method: "POST",
      body: JSON.stringify({ pattern: "*.txt" }),
      headers: { "content-type": "application/json" },
    }));

    expect(noTokenResponse.status).toBe(401);
    expect(await noTokenResponse.json()).toEqual({ error: "Missing or invalid Authorization header" });
  });

  test("system routes reject requests with insufficient scope", async () => {
    const container = await createContainer();
    const router = new Router();
    const testSecret = "test-secret-key-for-unit-tests";
    const testGuard = new JwtGuard({ secret: testSecret, issuer: undefined, audience: undefined });
    registerSystemRoutes(router, container.commandBus, container.queryBus, testGuard, container.logger);

    const readOnlyToken = await new SignJWT({ scope: SCOPES.FILES_READ })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(testSecret));

    const insufficientResponse = await router.handle(new Request("http://localhost/system/files/move", {
      method: "POST",
      body: JSON.stringify({ source: "/tmp/a", destination: "/tmp/b" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${readOnlyToken}` },
    }));

    expect(insufficientResponse.status).toBe(403);
    const body = await insufficientResponse.json() as { error: string; required: string };
    expect(body.error).toBe("Insufficient scope");
    expect(body.required).toBe(SCOPES.FILES_WRITE);
  });
});

async function isToolAvailable(tool: "awk" | "sed"): Promise<boolean> {
  const check = process.platform === "win32"
    ? Bun.spawn(["where.exe", tool], { stdout: "ignore", stderr: "ignore" })
    : Bun.spawn(["/bin/sh", "-lc", `command -v ${tool}`], { stdout: "ignore", stderr: "ignore" });

  return await check.exited === 0;
}
