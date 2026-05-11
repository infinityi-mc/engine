import type { LoggerPort } from "../../../shared/observability/logger.port";
import { SchemaNotFoundError, UnsafeRegexError } from "../domain/errors/mcdoc.errors";
import { validateRegexPattern } from "../../../shared/validation/regex-safety";
import type { McdocLoaderPort } from "../domain/ports/mcdoc-loader.port";
import type {
  McdocRepositoryPort,
  SchemaProjection,
  SearchOptions,
} from "../domain/ports/mcdoc-repository.port";
import type {
  DerivedIndex,
  GrepFieldMatch,
  McdocMeta,
  PackageListing,
  RawMcdocDocument,
  RawSchemaEntry,
  SchemaFieldsOnly,
  SchemaSummary,
  SearchHit,
} from "../domain/types/mcdoc.types";
import { projectFieldsOnly, projectSummary } from "./projection";
import { clampLimit, search } from "./search";

const DEFAULT_GREP_LIMIT = 100;
const MAX_GREP_LIMIT = 500;
const DEFAULT_REF_LIMIT = 100;
const MAX_REF_LIMIT = 500;

/**
 * In-memory repository over a {@link DerivedIndex}. Build via {@link McdocRepository.create}.
 */
export class McdocRepository implements McdocRepositoryPort {
  static async create(loader: McdocLoaderPort, logger: LoggerPort): Promise<McdocRepository> {
    const { raw, index } = await loader.load();
    return new McdocRepository(raw, index, logger);
  }

  private constructor(
    private readonly raw: RawMcdocDocument,
    private readonly index: DerivedIndex,
    private readonly logger: LoggerPort,
  ) {}

  meta(): McdocMeta {
    return this.index.meta;
  }

  listPackages(prefix?: string): PackageListing {
    const normalized = prefix ?? "";
    const children = this.index.packages[normalized] ?? [];
    const schemas = this.index.packageSchemas[normalized] ?? [];

    return {
      prefix: normalized,
      children,
      schemas,
    };
  }

  getSchema(path: string, projection: "summary"): SchemaSummary;
  getSchema(path: string, projection: "fields-only"): SchemaFieldsOnly;
  getSchema(path: string, projection: "full"): RawSchemaEntry;
  getSchema(path: string, projection: SchemaProjection): SchemaSummary | SchemaFieldsOnly | RawSchemaEntry;
  getSchema(path: string, projection: SchemaProjection): SchemaSummary | SchemaFieldsOnly | RawSchemaEntry {
    const entry = this.raw.mcdoc[path];
    if (!entry) throw new SchemaNotFoundError(path);

    switch (projection) {
      case "full":
        return entry;
      case "fields-only":
        return projectFieldsOnly(path, entry);
      case "summary":
      default:
        return projectSummary(path, entry);
    }
  }

  search(query: string, opts: SearchOptions = {}): readonly SearchHit[] {
    const hits = search(this.index, {
      query,
      ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
      ...(opts.package !== undefined ? { package: opts.package } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    });
    this.logger.info("mcdoc.search", { query, resultCount: hits.length });
    return hits;
  }

  grepFields(pattern: string, limit?: number): readonly GrepFieldMatch[] {
    const regexError = validateRegexPattern(pattern);
    if (regexError !== undefined) {
      throw new UnsafeRegexError(regexError);
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      throw new UnsafeRegexError(error instanceof Error ? error.message : String(error));
    }

    const cap = clampLimit(limit, DEFAULT_GREP_LIMIT, MAX_GREP_LIMIT);
    const out: GrepFieldMatch[] = [];

    for (const [fieldKey, hits] of Object.entries(this.index.fieldIndex)) {
      if (!regex.test(fieldKey)) continue;
      for (const hit of hits) {
        out.push(hit);
        if (out.length >= cap) return out;
      }
    }

    return out;
  }

  findReferences(path: string, limit?: number): readonly string[] {
    if (!(path in this.index.kinds)) throw new SchemaNotFoundError(path);

    const cap = clampLimit(limit, DEFAULT_REF_LIMIT, MAX_REF_LIMIT);
    const all = this.index.reverseRefs[path] ?? [];
    return all.slice(0, cap);
  }
}
