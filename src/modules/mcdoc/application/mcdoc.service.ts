import type { LoggerPort } from "../../../shared/observability/logger.port";
import type { McdocApiPort } from "../domain/ports/mcdoc-api.port";
import type { McdocStoragePort } from "../domain/ports/mcdoc-storage.port";
import type { McdocVersion, McdocSymbols, McdocVersionData } from "../domain/types/mcdoc";

export interface McdocServiceInput {
  readonly api: McdocApiPort;
  readonly storage: McdocStoragePort;
  readonly logger: LoggerPort;
}

export class McdocService {
  private readonly api: McdocApiPort;
  private readonly storage: McdocStoragePort;
  private readonly logger: LoggerPort;

  constructor(input: McdocServiceInput) {
    this.api = input.api;
    this.storage = input.storage;
    this.logger = input.logger;
  }

  async fetchVersions(): Promise<McdocVersion[]> {
    this.logger.info("mcdoc.fetch_versions.start");
    const versions = await this.api.fetchVersions();
    await this.storage.saveVersions(versions);
    this.logger.info("mcdoc.fetch_versions.done", { count: versions.length });
    return versions;
  }

  async fetchSymbols(): Promise<McdocSymbols> {
    this.logger.info("mcdoc.fetch_symbols.start");
    const symbols = await this.api.fetchSymbols();
    await this.storage.saveSymbols(symbols);
    const symbolCount = Object.keys(symbols.mcdoc).length;
    this.logger.info("mcdoc.fetch_symbols.done", { ref: symbols.ref, symbolCount });
    return symbols;
  }

  async fetchVersionData(version: string): Promise<McdocVersionData> {
    this.logger.info("mcdoc.fetch_version_data.start", { version });

    const [blockStates, commands, registries] = await Promise.all([
      this.api.fetchBlockStates(version),
      this.api.fetchCommands(version),
      this.api.fetchRegistries(version),
    ]);

    const data: McdocVersionData = { blockStates, commands, registries };
    await this.storage.saveVersionData(version, data);
    this.logger.info("mcdoc.fetch_version_data.done", { version });
    return data;
  }

  async getVersions(): Promise<McdocVersion[] | undefined> {
    return this.storage.loadVersions();
  }

  async getSymbols(): Promise<McdocSymbols | undefined> {
    return this.storage.loadSymbols();
  }

  async getVersionData(version: string): Promise<McdocVersionData | undefined> {
    return this.storage.loadVersionData(version);
  }

  async listCachedVersions(): Promise<string[]> {
    return this.storage.listStoredVersions();
  }
}
