import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { buildIndex } from "../../application/indexer";
import type { McdocLoaderPort } from "../../domain/ports/mcdoc-loader.port";
import type { DerivedIndex, RawMcdocDocument } from "../../domain/types/mcdoc.types";

export interface FileMcdocLoaderConfig {
  readonly symbolPath: string;
  readonly indexDir: string;
  readonly logger: LoggerPort;
}

/**
 * Loads `symbol.json` and either loads a previously-persisted derived index
 * sidecar for that `ref`, or builds + persists a fresh one.
 */
export class FileMcdocLoader implements McdocLoaderPort {
  constructor(private readonly config: FileMcdocLoaderConfig) {}

  async load(): Promise<{ raw: RawMcdocDocument; index: DerivedIndex }> {
    const { symbolPath, indexDir, logger } = this.config;

    if (!existsSync(symbolPath)) {
      logger.warn("mcdoc.symbol_file.missing", {
        symbolPath,
        message: "mcdoc tools will return empty results until symbol.json is provided",
      });
      const emptyRaw: RawMcdocDocument = { ref: "unknown", mcdoc: {} };
      return { raw: emptyRaw, index: buildIndex(emptyRaw.ref, emptyRaw.mcdoc) };
    }

    const raw = (await Bun.file(symbolPath).json()) as RawMcdocDocument;
    if (typeof raw.ref !== "string" || typeof raw.mcdoc !== "object" || raw.mcdoc === null) {
      throw new Error(`mcdoc symbol file has invalid shape: ${symbolPath}`);
    }

    const sidecarDir = path.join(indexDir, raw.ref);
    const sidecarPath = path.join(sidecarDir, "index.json");

    if (existsSync(sidecarPath)) {
      try {
        const persisted = (await Bun.file(sidecarPath).json()) as DerivedIndex;
        if (persisted.meta?.ref === raw.ref && persisted.meta.schemaCount === Object.keys(raw.mcdoc).length) {
          logger.info("mcdoc.index.load", {
            ref: raw.ref,
            schemaCount: persisted.meta.schemaCount,
            source: "disk",
          });
          return { raw, index: persisted };
        }
        logger.warn("mcdoc.index.load.stale", { ref: raw.ref });
      } catch (error) {
        logger.warn("mcdoc.index.load.failed", {
          ref: raw.ref,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const buildStart = Date.now();
    const index = buildIndex(raw.ref, raw.mcdoc);
    logger.info("mcdoc.index.build", {
      ref: raw.ref,
      schemaCount: index.meta.schemaCount,
      durationMs: Date.now() - buildStart,
    });

    try {
      await mkdir(sidecarDir, { recursive: true });
      await writeFile(sidecarPath, JSON.stringify(index), "utf8");
      logger.info("mcdoc.index.persist", { ref: raw.ref, path: sidecarPath });
    } catch (error) {
      logger.warn("mcdoc.index.persist.failed", {
        ref: raw.ref,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { raw, index };
  }
}
