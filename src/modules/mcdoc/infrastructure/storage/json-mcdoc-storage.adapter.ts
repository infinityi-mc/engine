import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { McdocStoragePort } from "../../domain/ports/mcdoc-storage.port";
import type { McdocSymbols, McdocVersion, McdocVersionData } from "../../domain/types/mcdoc";
import type { McdocRagIndex } from "../../domain/types/mcdoc-rag";

export interface JsonMcdocStorageAdapterInput {
  readonly dataDir: string;
  readonly logger: LoggerPort;
}

interface Metadata {
  version: string;
}

const RAG_MANIFEST_FILE = "rag_manifest.json";
const RAG_DOCUMENTS_FILE = "rag_documents.json";
const RAG_VECTORS_FILE = "rag_vectors.f32";
const LEGACY_RAG_EMBEDDINGS_FILE = "rag_embeddings.json";

export class JsonMcdocStorageAdapter implements McdocStoragePort {
  private readonly basePath: string;
  private readonly vectorPath: string;
  private readonly logger: LoggerPort;

  constructor(input: JsonMcdocStorageAdapterInput) {
    this.basePath = path.join(input.dataDir, "mcdoc", "spyglassmc");
    this.vectorPath = path.join(input.dataDir, "mcdoc", "vectors");
    this.logger = input.logger;
  }

  async saveSymbols(symbols: McdocSymbols): Promise<void> {
    await this.writeJson(path.join(this.basePath, "symbols.json"), symbols);
  }

  async loadSymbols(): Promise<McdocSymbols | undefined> {
    return this.readJson<McdocSymbols>(path.join(this.basePath, "symbols.json"));
  }

  async saveVersions(versions: readonly McdocVersion[]): Promise<void> {
    await this.writeJson(path.join(this.basePath, "versions.json"), versions);
  }

  async loadVersions(): Promise<readonly McdocVersion[] | undefined> {
    return this.readJson<readonly McdocVersion[]>(path.join(this.basePath, "versions.json"));
  }

  async saveVersionData(version: string, data: Omit<McdocVersionData, "version">): Promise<void> {
    await Promise.all([
      this.writeJson(path.join(this.basePath, "metadata.json"), { version }),
      this.writeJson(path.join(this.basePath, "block_states.json"), data.blockStates),
      this.writeJson(path.join(this.basePath, "commands.json"), data.commands),
      this.writeJson(path.join(this.basePath, "registries.json"), data.registries),
    ]);
  }

  async loadVersionData(): Promise<McdocVersionData | undefined> {
    const [metadata, blockStates, commands, registries, versions] = await Promise.all([
      this.readJson<Metadata>(path.join(this.basePath, "metadata.json")),
      this.readJson<unknown>(path.join(this.basePath, "block_states.json")),
      this.readJson<unknown>(path.join(this.basePath, "commands.json")),
      this.readJson<unknown>(path.join(this.basePath, "registries.json")),
      this.readJson<readonly McdocVersion[]>(path.join(this.basePath, "versions.json")),
    ]);

    if (blockStates === undefined && commands === undefined && registries === undefined) {
      return undefined;
    }

    const version = metadata?.version
      ?? versions?.find((v) => v.stable && v.type === "release")?.id
      ?? versions?.[0]?.id;

    if (!version) return undefined;

    return { version, blockStates, commands, registries };
  }

  async saveRagIndex(index: McdocRagIndex): Promise<void> {
    await mkdir(this.vectorPath, { recursive: true });
    await Promise.all([
      this.writeJson(path.join(this.vectorPath, RAG_MANIFEST_FILE), index.manifest),
      this.writeJson(path.join(this.vectorPath, RAG_DOCUMENTS_FILE), index.documents),
      this.writeFloat32(path.join(this.vectorPath, RAG_VECTORS_FILE), index.vectors.values),
    ]);
    await unlink(path.join(this.vectorPath, LEGACY_RAG_EMBEDDINGS_FILE)).catch((error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      this.logger.warn("mcdoc.storage.legacy_embeddings_delete_failed", {
        filePath: path.join(this.vectorPath, LEGACY_RAG_EMBEDDINGS_FILE),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async loadRagIndex(): Promise<McdocRagIndex | undefined> {
    const [manifest, documents, vectorValues] = await Promise.all([
      this.readJson<McdocRagIndex["manifest"]>(path.join(this.vectorPath, RAG_MANIFEST_FILE)),
      this.readJson<McdocRagIndex["documents"]>(path.join(this.vectorPath, RAG_DOCUMENTS_FILE)),
      this.readFloat32(path.join(this.vectorPath, RAG_VECTORS_FILE)),
    ]);

    if (!manifest || !documents || !vectorValues) return undefined;
    return { manifest, documents, vectors: { dimensions: manifest.vectorDimensions, values: vectorValues } };
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

  private async readFloat32(filePath: string): Promise<Float32Array | undefined> {
    let content: Buffer;
    try {
      content = await readFile(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      this.logger.warn("mcdoc.storage.read_error", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }

    if (content.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Invalid Float32 vector file byte length: ${content.byteLength}`);
    }
    if (content.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
      return new Float32Array(
        content.buffer,
        content.byteOffset,
        content.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
    }

    const copy = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    return new Float32Array(copy);
  }

  private async writeFloat32(filePath: string, data: Float32Array): Promise<void> {
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = filePath + ".tmp";
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      await writeFile(tempPath, buffer);
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
