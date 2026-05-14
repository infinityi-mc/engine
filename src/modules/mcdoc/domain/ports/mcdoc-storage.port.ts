import type { McdocSymbols, McdocVersionData } from "../types/mcdoc";

export interface McdocStoragePort {
  saveSymbols(symbols: McdocSymbols): Promise<void>;
  loadSymbols(): Promise<McdocSymbols | undefined>;
  saveVersionData(version: string, data: Omit<McdocVersionData, "version">): Promise<void>;
  loadVersionData(): Promise<McdocVersionData | undefined>;
}
