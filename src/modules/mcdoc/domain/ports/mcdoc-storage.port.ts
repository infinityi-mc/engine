import type { McdocSymbols, McdocVersion, McdocVersionData } from "../types/mcdoc";
import type { McdocRagIndex } from "../types/mcdoc-rag";

export interface McdocStoragePort {
  saveSymbols(symbols: McdocSymbols): Promise<void>;
  loadSymbols(): Promise<McdocSymbols | undefined>;
  saveVersions(versions: readonly McdocVersion[]): Promise<void>;
  loadVersions(): Promise<readonly McdocVersion[] | undefined>;
  saveVersionData(version: string, data: Omit<McdocVersionData, "version">): Promise<void>;
  loadVersionData(): Promise<McdocVersionData | undefined>;
  saveRagIndex(index: McdocRagIndex): Promise<void>;
  loadRagIndex(): Promise<McdocRagIndex | undefined>;
}
