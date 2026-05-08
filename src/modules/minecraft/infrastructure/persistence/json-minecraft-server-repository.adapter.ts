import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { MinecraftServerRepositoryPort } from "../../domain/ports/minecraft-server-repository.port";
import type { MinecraftServer } from "../../domain/types/minecraft-server";

interface ServerStore {
  servers: MinecraftServer[];
}

export class JsonMinecraftServerRepositoryAdapter implements MinecraftServerRepositoryPort {
  private readonly filePath: string;
  private servers: Map<string, MinecraftServer> = new Map();
  private loaded = false;

  constructor(
    private readonly logger: LoggerPort,
    dataDir: string,
  ) {
    this.filePath = path.join(dataDir, "minecraft", "servers.json");
  }

  async save(server: MinecraftServer): Promise<void> {
    await this.ensureLoaded();
    this.servers.set(server.id, server);
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    this.servers.delete(id);
    await this.persist();
  }

  async get(id: string): Promise<MinecraftServer | undefined> {
    await this.ensureLoaded();
    return this.servers.get(id);
  }

  async list(): Promise<MinecraftServer[]> {
    await this.ensureLoaded();
    return [...this.servers.values()];
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await readFile(this.filePath, "utf8");
      const store: ServerStore = JSON.parse(content);
      const servers = Array.isArray(store.servers) ? store.servers : [];
      for (const server of servers) {
        this.servers.set(server.id, server);
      }
    } catch (error) {
      // File doesn't exist yet — start with empty store
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        this.logger.warn("minecraft.repository.load_error", {
          module: "minecraft",
          operation: "repository.load",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const store: ServerStore = {
      servers: [...this.servers.values()],
    };

    const json = JSON.stringify(store, null, 2);

    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });

      // Atomic write: write to temp file, then rename
      const tempPath = this.filePath + ".tmp";
      await writeFile(tempPath, json, "utf8");
      await rename(tempPath, this.filePath);
    } catch (error) {
      this.logger.error("minecraft.repository.persist_error", {
        module: "minecraft",
        operation: "repository.persist",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
