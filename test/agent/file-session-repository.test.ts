import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileSessionRepository } from "../../src/modules/agent/infrastructure/persistence/file-session-repository.adapter";
import type { AgentSession } from "../../src/modules/agent/domain/types/agent.types";
import { noopLogger } from "../../src/shared/observability/logger.port";

function makeSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    sessionId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    agentId: "test-agent",
    messages: [
      { role: "system", content: "You are a test agent." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ],
    status: "completed",
    createdAt: 1700000000000,
    completedAt: 1700000001000,
    usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, totalTokens: 30 },
    iterationCount: 1,
    ...overrides,
  };
}

let tempDir: string;
let repo: FileSessionRepository;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "session-repo-test-"));
  repo = new FileSessionRepository({ dataDir: tempDir, logger: noopLogger });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("FileSessionRepository", () => {
  test("save() creates file at dataDir/{sessionId}.json", async () => {
    const session = makeSession();
    await repo.save(session);

    const filePath = path.join(tempDir, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.json");
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as AgentSession;
    expect(parsed.sessionId).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
  });

  test("save() creates dataDir directory if it does not exist", async () => {
    const nestedDir = path.join(tempDir, "nested", "sessions");
    const nestedRepo = new FileSessionRepository({ dataDir: nestedDir, logger: noopLogger });

    await nestedRepo.save(makeSession());

    const content = await readFile(path.join(nestedDir, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.json"), "utf8");
    expect(JSON.parse(content).sessionId).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
  });

  test("save() uses atomic write (temp file then rename)", async () => {
    const session = makeSession();
    await repo.save(session);

    // Temp file should not remain after successful save
    const tempPath = path.join(tempDir, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.json.tmp");
    const finalPath = path.join(tempDir, "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.json");

    // Final file should exist
    const content = await readFile(finalPath, "utf8");
    expect(JSON.parse(content).sessionId).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");

    // Temp file should NOT exist (rename consumed it)
    await expect(readFile(tempPath, "utf8")).rejects.toThrow();
  });

  test("load() returns session for valid file", async () => {
    const session = makeSession();
    await repo.save(session);

    const loaded = await repo.load("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(loaded!.agentId).toBe("test-agent");
    expect(loaded!.messages).toHaveLength(3);
    expect(loaded!.status).toBe("completed");
    expect(loaded!.usage.totalTokens).toBe(30);
  });

  test("load() returns null for missing file", async () => {
    const loaded = await repo.load("b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e");
    expect(loaded).toBeNull();
  });

  test("load() returns null for corrupt JSON", async () => {
    const corruptId = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
    const filePath = path.join(tempDir, `${corruptId}.json`);
    await Bun.write(filePath, "{ not valid json !!!");

    const loaded = await repo.load(corruptId);
    expect(loaded).toBeNull();
  });

  test("load() returns null for JSON missing required fields", async () => {
    const incompleteId = "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a";
    const filePath = path.join(tempDir, `${incompleteId}.json`);
    await Bun.write(filePath, JSON.stringify({ sessionId: incompleteId }));

    const loaded = await repo.load(incompleteId);
    expect(loaded).toBeNull();
  });

  test("round-trip: save then load preserves all fields exactly", async () => {
    const session = makeSession({
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user message" },
        { role: "assistant", content: "assistant reply", toolCalls: [{ id: "tc1", type: "function", function: { name: "read_file", arguments: '{"path":"/f.txt"}' } }] },
        { role: "tool", toolCallId: "tc1", toolName: "read_file", content: "file contents" },
        { role: "assistant", content: "final answer" },
      ],
      usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 10, totalTokens: 160 },
      iterationCount: 3,
      status: "completed",
      completedAt: 1700000099000,
    });

    await repo.save(session);
    const loaded = await repo.load(session.sessionId);

    expect(loaded).toEqual(session);
  });

  test("save() overwrites existing file atomically", async () => {
    const session1 = makeSession({ status: "active", iterationCount: 0 });
    await repo.save(session1);

    const session2 = makeSession({ status: "completed", iterationCount: 5, completedAt: Date.now() });
    await repo.save(session2);

    const loaded = await repo.load("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(loaded!.status).toBe("completed");
    expect(loaded!.iterationCount).toBe(5);
  });

  test("save() rejects path traversal sessionId", async () => {
    const session = makeSession({ sessionId: "../../etc/evil" });
    expect(repo.save(session)).rejects.toThrow("Invalid sessionId format");
  });

  test("load() rejects path traversal sessionId", async () => {
    expect(repo.load("../../etc/evil")).rejects.toThrow("Invalid sessionId format");
  });

  test("save() rejects empty sessionId", async () => {
    const session = makeSession({ sessionId: "" });
    expect(repo.save(session)).rejects.toThrow("Invalid sessionId format");
  });

  test("load() rejects empty sessionId", async () => {
    expect(repo.load("")).rejects.toThrow("Invalid sessionId format");
  });

  test("save() rejects sessionId with special characters", async () => {
    const session = makeSession({ sessionId: "../traversal" });
    expect(repo.save(session)).rejects.toThrow("Invalid sessionId format");
  });

  test("load() rejects very long sessionId", async () => {
    const longId = "a".repeat(1000);
    expect(repo.load(longId)).rejects.toThrow("Invalid sessionId format");
  });

  test("load() returns null for JSON missing usage", async () => {
    const noUsageId = "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b";
    const filePath = path.join(tempDir, `${noUsageId}.json`);
    const obj = {
      sessionId: noUsageId,
      agentId: "test-agent",
      messages: [],
      status: "completed",
      createdAt: 1700000000000,
      iterationCount: 0,
    };
    await Bun.write(filePath, JSON.stringify(obj));

    const loaded = await repo.load(noUsageId);
    expect(loaded).toBeNull();
  });
});
