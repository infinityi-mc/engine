import type {
  GrepFieldMatch,
  McdocMeta,
  PackageListing,
  RawSchemaEntry,
  SchemaFieldsOnly,
  SchemaKind,
  SchemaSummary,
  SearchHit,
} from "../types/mcdoc.types";

export type SchemaProjection = "summary" | "full" | "fields-only";

export interface SearchOptions {
  readonly kind?: SchemaKind;
  readonly package?: string;
  readonly limit?: number;
}

export interface McdocRepositoryPort {
  meta(): McdocMeta;
  listPackages(prefix?: string): PackageListing;
  getSchema(path: string, projection: "summary"): SchemaSummary;
  getSchema(path: string, projection: "fields-only"): SchemaFieldsOnly;
  getSchema(path: string, projection: "full"): RawSchemaEntry;
  getSchema(path: string, projection: SchemaProjection): SchemaSummary | SchemaFieldsOnly | RawSchemaEntry;
  search(query: string, opts?: SearchOptions): readonly SearchHit[];
  grepFields(pattern: string, limit?: number): readonly GrepFieldMatch[];
  findReferences(path: string, limit?: number): readonly string[];
}
