import type { DerivedIndex, RawMcdocDocument } from "../types/mcdoc.types";

/**
 * Loads the raw mcdoc registry and its derived index. Infrastructure adapters
 * implement this (filesystem, in-memory test double, remote fetch, etc.).
 */
export interface McdocLoaderPort {
  load(): Promise<{ raw: RawMcdocDocument; index: DerivedIndex }>;
}
