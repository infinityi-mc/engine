export type McdocRagSource = "symbols" | "commands" | "registries" | "block_states" | "versions";

export type McdocRagKind =
  | "symbol"
  | "symbol_field"
  | "command"
  | "registry"
  | "registry_entry"
  | "block_state"
  | "version";

export interface McdocRagMetadata {
  readonly source: McdocRagSource;
  readonly kind: McdocRagKind;
  readonly jsonPath: string;
  readonly version?: string;
  readonly symbolPath?: string;
  readonly commandPath?: string;
  readonly registry?: string;
  readonly blockId?: string;
  readonly entryId?: string;
  readonly references?: readonly string[];
}

export interface McdocRagDocument {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly metadata: McdocRagMetadata;
}

export interface McdocRagVector {
  readonly documentId: string;
  readonly values: readonly number[];
}

export type McdocRagStorageFormat = "f32-binary";

export interface McdocRagVectorStore {
  readonly dimensions: number;
  readonly values: Float32Array;
}

export interface McdocRagManifest {
  readonly indexVersion: number;
  readonly embeddingModel: string;
  readonly storageFormat: McdocRagStorageFormat;
  readonly vectorDimensions: number;
  readonly generatedAt: string;
  readonly documentCount: number;
  readonly vectorCount: number;
  readonly sourceVersion?: string;
  readonly symbolRef?: string;
}

export interface McdocRagIndex {
  readonly manifest: McdocRagManifest;
  readonly documents: readonly McdocRagDocument[];
  readonly vectors: McdocRagVectorStore;
}

export interface McdocRagFilters {
  readonly source?: McdocRagSource;
  readonly kind?: McdocRagKind;
  readonly version?: string;
  readonly symbolPath?: string;
  readonly registry?: string;
  readonly blockId?: string;
}

export interface McdocCitation {
  readonly source: McdocRagSource;
  readonly jsonPath: string;
  readonly title: string;
}

export interface McdocSearchResult {
  readonly document: McdocRagDocument;
  readonly score: number;
  readonly citation: McdocCitation;
}

export interface McdocRagAnswer {
  readonly answer: string;
  readonly citations: readonly McdocCitation[];
}
