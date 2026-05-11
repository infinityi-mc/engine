/**
 * Raw mcdoc schema entry. The structure is data-driven; we only model what we
 * read for indexing, projection, and reference extraction. Everything else is
 * passed through verbatim when `projection = "full"`.
 */
export type SchemaKind = "struct" | "enum" | "union" | "template" | string;

export interface RawSchemaEntry {
  readonly kind: SchemaKind;
  readonly fields?: readonly RawField[];
  readonly members?: readonly unknown[];
  readonly child?: unknown;
  readonly values?: readonly unknown[];
  readonly enumKind?: string;
  readonly attributes?: readonly RawAttribute[];
  readonly [extra: string]: unknown;
}

export interface RawField {
  readonly kind: "pair" | "spread" | string;
  readonly key?: unknown; // string for static keys, object for dynamic keys
  readonly type?: RawType;
  readonly desc?: string;
  readonly optional?: boolean;
  readonly attributes?: readonly RawAttribute[];
}

export interface RawType {
  readonly kind: string; // "string" | "reference" | "list" | "struct" | "literal" | ...
  readonly path?: string;
  readonly item?: RawType;
  readonly attributes?: readonly RawAttribute[];
  readonly [extra: string]: unknown;
}

export interface RawAttribute {
  readonly name: string;
  readonly value?: unknown;
}

/** Source document loaded from disk. */
export interface RawMcdocDocument {
  readonly ref: string;
  readonly mcdoc: Record<string, RawSchemaEntry>;
}

/** Summary projection of a single schema. */
export interface SchemaSummary {
  readonly path: string;
  readonly kind: SchemaKind;
  readonly attributes?: readonly RawAttribute[];
  readonly fieldSummary?: readonly FieldSummary[];
  readonly memberCount?: number;
  readonly valueCount?: number;
  readonly descFirstLine?: string;
}

export interface FieldSummary {
  readonly key: string;
  readonly typeKind: string;
  readonly refPath?: string;
  readonly optional: boolean;
  readonly descFirstLine?: string;
}

/** Fields-only projection. */
export interface SchemaFieldsOnly {
  readonly path: string;
  readonly fields: readonly FieldSummary[];
}

/** Ranked search hit returned to callers. */
export interface SearchHit {
  readonly path: string;
  readonly kind: SchemaKind;
  readonly score: number;
  readonly matchedOn: readonly ("path" | "field" | "desc")[];
  readonly snippet?: string;
}

/** Result of `findReferences`. */
export interface GrepFieldMatch {
  readonly path: string;
  readonly fieldKey: string;
  readonly descFirstLine?: string;
}

/** Top-level metadata about the loaded index. */
export interface McdocMeta {
  readonly ref: string;
  readonly schemaCount: number;
  readonly builtAt: string;
}

/** Package listing result. */
export interface PackageListing {
  readonly prefix: string;
  readonly children: readonly string[];
  readonly schemas: readonly string[];
}

/** Persistable derived index produced by the indexer. */
export interface DerivedIndex {
  readonly meta: McdocMeta;
  readonly paths: readonly string[];
  /** Tree of package -> immediate children (sub-packages only, no leaf schemas). */
  readonly packages: Record<string, string[]>;
  /** Schemas grouped by their package prefix (the FQN minus the last segment). */
  readonly packageSchemas: Record<string, string[]>;
  /** Token -> paths (for name/path search; includes path segment tokens). */
  readonly nameIndex: Record<string, string[]>;
  /** Field key -> list of { path, descFirstLine }. */
  readonly fieldIndex: Record<string, GrepFieldMatch[]>;
  /** Token -> paths (description full-text). */
  readonly descIndex: Record<string, string[]>;
  /** Target path -> paths that reference it. */
  readonly reverseRefs: Record<string, string[]>;
  /** path -> kind (cached for quick filtering). */
  readonly kinds: Record<string, SchemaKind>;
}
