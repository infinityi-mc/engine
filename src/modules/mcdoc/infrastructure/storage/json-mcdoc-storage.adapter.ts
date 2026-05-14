import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { McdocStoragePort } from "../../domain/ports/mcdoc-storage.port";
import type { McdocSymbols, McdocVersionData } from "../../domain/types/mcdoc";

export interface JsonMcdocStorageAdapterInput {
  readonly dataDir: string;
  readonly logger: LoggerPort;
}

interface Metadata {
  version: string;
}

export class JsonMcdocStorageAdapter implements McdocStoragePort {
  private readonly basePath: string;
  private readonly logger: LoggerPort;

  constructor(input: JsonMcdocStorageAdapterInput) {
    this.basePath = path.join(input.dataDir, "mcdoc", "spyglassmc");
    this.logger = input.logger;
  }

  async saveSymbols(symbols: McdocSymbols): Promise<void> {
    await this.writeJson(path.join(this.basePath, "symbols.json"), symbols);
  }

  async loadSymbols(): Promise<McdocSymbols | undefined> {
    return this.readJson<McdocSymbols>(path.join(this.basePath, "symbols.json"));
  }

  async saveVersionData(version: string, data: Omit<McdocVersionData, "version">): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    await Promise.all([
      this.writeJson(path.join(this.basePath, "metadata.json"), { version }),
      this.writeJson(path.join(this.basePath, "block_states.json"), data.blockStates),
      this.writeJson(path.join(this.basePath, "commands.json"), data.commands),
      this.writeJson(path.join(this.basePath, "registries.json"), data.registries),
    ]);
  }

  async loadVersionData(): Promise<McdocVersionData | undefined> {
    const [metadata, blockStates, commands, registries] = await Promise.all([
      this.readJson<Metadata>(path.join(this.basePath, "metadata.json")),
      this.readJson<unknown>(path.join(this.basePath, "block_states.json")),
      this.readJson<unknown>(path.join(this.basePath, "commands.json")),
      this.readJson<unknown>(path.join(this.basePath, "registries.json")),
    ]);

    if (!metadata || (blockStates === undefined && commands === undefined && registries === undefined)) {
      return undefined;
    }

    return { version: metadata.version, blockStates, commands, registries };
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
