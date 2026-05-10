import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { AgentSession } from "../../domain/types/agent.types";
import type { SessionRepositoryPort } from "../../domain/ports/session-repository.port";
import { isValidUUID } from "../../../../shared/validation/uuid";

export interface FileSessionRepositoryDeps {
  readonly dataDir: string;
  readonly logger: LoggerPort;
}

export class FileSessionRepository implements SessionRepositoryPort {
  constructor(private readonly deps: FileSessionRepositoryDeps) {}

  async save(session: AgentSession): Promise<void> {
    const filePath = this.buildPath(session.sessionId);
    const json = JSON.stringify(session, null, 2);

    try {
      await mkdir(this.deps.dataDir, { recursive: true });

      // Atomic write: write to temp file, then rename
      const tempPath = filePath + ".tmp";
      await writeFile(tempPath, json, "utf8");
      await rename(tempPath, filePath);
    } catch (error) {
      this.deps.logger.error("agent.session.persist_error", {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async load(sessionId: string): Promise<AgentSession | null> {
    const filePath = this.buildPath(sessionId);

    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      this.deps.logger.error("agent.session.load_error", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.deps.logger.warn("agent.session.corrupt_json", { sessionId });
      return null;
    }

    if (!this.isValidSession(parsed)) {
      this.deps.logger.warn("agent.session.invalid_shape", { sessionId });
      return null;
    }

    return parsed;
  }

  private buildPath(sessionId: string): string {
    if (!isValidUUID(sessionId)) {
      throw new Error(`Invalid sessionId format: expected UUID, got "${sessionId}"`);
    }
    return path.join(this.deps.dataDir, `${sessionId}.json`);
  }

  private isValidSession(value: unknown): value is AgentSession {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (
      typeof obj.sessionId !== "string" ||
      typeof obj.agentId !== "string" ||
      !Array.isArray(obj.messages) ||
      typeof obj.status !== "string" ||
      typeof obj.createdAt !== "number" ||
      typeof obj.iterationCount !== "number"
    ) {
      return false;
    }
    const usage = obj.usage as Record<string, unknown> | undefined;
    if (typeof usage !== "object" || usage === null) return false;
    if (
      typeof usage.inputTokens !== "number" ||
      typeof usage.outputTokens !== "number" ||
      typeof usage.totalTokens !== "number"
    ) {
      return false;
    }
    return true;
  }
}
