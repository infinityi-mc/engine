import type { McdocVersion, McdocSymbols } from "../types/mcdoc";

export interface McdocApiPort {
  fetchVersions(): Promise<McdocVersion[]>;
  fetchSymbols(): Promise<McdocSymbols>;
  fetchBlockStates(version: string): Promise<unknown>;
  fetchCommands(version: string): Promise<unknown>;
  fetchRegistries(version: string): Promise<unknown>;
}
