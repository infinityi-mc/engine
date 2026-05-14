import type { McdocVersion, McdocSymbols, McdocVersionData } from "../types/mcdoc";

export interface McdocStoragePort {
  saveVersions(versions: McdocVersion[]): Promise<void>;
  loadVersions(): Promise<McdocVersion[] | undefined>;
  saveSymbols(symbols: McdocSymbols): Promise<void>;
  loadSymbols(): Promise<McdocSymbols | undefined>;
  saveVersionData(version: string, data: McdocVersionData): Promise<void>;
  loadVersionData(version: string): Promise<McdocVersionData | undefined>;
  listStoredVersions(): Promise<string[]>;
}
