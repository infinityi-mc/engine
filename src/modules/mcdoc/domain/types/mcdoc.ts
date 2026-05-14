export interface McdocVersion {
  readonly id: string;
  readonly name: string;
  readonly type: "release" | "snapshot";
  readonly stable: boolean;
  readonly dataVersion: number;
  readonly protocolVersion: number;
  readonly dataPackVersion: number;
  readonly dataPackVersionMinor: number;
  readonly resourcePackVersion: number;
  readonly resourcePackVersionMinor: number;
  readonly buildTime: string;
  readonly releaseTime: string;
  readonly sha1: string;
}

export interface McdocSymbolEntry {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface McdocSymbols {
  readonly ref: string;
  readonly mcdoc: Record<string, McdocSymbolEntry>;
}

export interface McdocVersionData {
  readonly blockStates: unknown;
  readonly commands: unknown;
  readonly registries: unknown;
}
