import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { McdocStoragePort } from "../../domain/ports/mcdoc-storage.port";
import type { McdocVersion, McdocSymbols, McdocVersionData } from "../../domain/types/mcdoc";

export interface JsonMcdocStorageAdapterInput {
  readonly dataDir: string;
  readonly logger: LoggerPort;
}

export class JsonMcdocStorageAdapter implements McdocStoragePort {
  private readonly basePath: string;
  private readonly logger: LoggerPort;

  constructor(input: JsonMcdocStorageAdapterInput) {
    this.basePath = path.join(input.dataDir, "mcdoc", "spyglassmc");
    this.logger = input.logger;
  }

  async saveVersions(versions: McdocVersion[]): Promise<void> {
    await this.writeJson(path.join(this.basePath, "versions.json"), versions);
  }

  async loadVersions(): Promise<McdocVersion[] | undefined> {
    return this.readJson<McdocVersion[]>(path.join(this.basePath, "versions.json"));
  }

  async saveSymbols(symbols: McdocSymbols): Promise<void> {
    await this.writeJson(path.join(this.basePath, "symbols.json"), symbols);
  }

  async loadSymbols(): Promise<McdocSymbols | undefined> {
    return this.readJson<McdocSymbols>(path.join(this.basePath, "symbols.json"));
  }

  async saveVersionData(version: string, data: McdocVersionData): Promise<void> {
    const dir = path.join(this.basePath, version);
    await mkdir(dir, { recursive: true });
    await Promise.all([
      this.writeJson(path.join(dir, "block_states.json"), data.blockStates),
      this.writeJson(path.join(dir, "commands.json"), data.commands),
      this.writeJson(path.join(dir, "registries.json"), data.registries),
    ]);
  }

  async loadVersionData(version: string): Promise<McdocVersionData | undefined> {
    const dir = path.join(this.basePath, version);
    const [blockStates, commands, registries] = await Promise.all([
      this.readJson<unknown>(path.join(dir, "block_states.json")),
      this.readJson<unknown>(path.join(dir, "commands.json")),
      this.readJson<unknown>(path.join(dir, "registries.json")),
    ]);

    if (blockStates === undefined && commands === undefined && registries === undefined) {
      return undefined;
    }

    return { blockStates, commands, registries };
  }

  async listStoredVersions(): Promise<string[]> {
    try {
      const entries = await readdir(this.basePath, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => name !== "temp");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw error;
    }
  }

  private async readJson<T>(filePath: string): Promise<T | undefined> {
    try {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      this.logger.warn("mcdoc.storage.read_error", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);

    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = filePath + ".tmp";
      await writeFile(tempPath, json, "utf8");
      await rename(tempPath, filePath);
    } catch (error) {
      this.logger.error("mcdoc.storage.write_error", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
