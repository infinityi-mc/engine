import type { LoggerPort } from "../../../shared/observability/logger.port";
import type { McdocApiPort } from "../domain/ports/mcdoc-api.port";
import type { McdocStoragePort } from "../domain/ports/mcdoc-storage.port";
import type { McdocSymbols, McdocVersionData } from "../domain/types/mcdoc";

export interface McdocServiceInput {
  readonly api: McdocApiPort;
  readonly storage: McdocStoragePort;
  readonly config: { getMcdocConfig(): { version?: string | undefined } };
  readonly logger: LoggerPort;
}

export class McdocService {
  private readonly api: McdocApiPort;
  private readonly storage: McdocStoragePort;
  private readonly config: { getMcdocConfig(): { version?: string | undefined } };
  private readonly logger: LoggerPort;

  constructor(input: McdocServiceInput) {
    this.api = input.api;
    this.storage = input.storage;
    this.config = input.config;
    this.logger = input.logger;
  }

  async resolveVersion(): Promise<string> {
    const configured = this.config.getMcdocConfig().version;
    if (configured) {
      this.logger.info("mcdoc.resolve_version.from_config", { version: configured });
      return configured;
    }

    this.logger.info("mcdoc.resolve_version.fetching_latest");
    const versions = await this.api.fetchVersions();
    const latest = versions.find((v) => v.stable && v.type === "release");
    if (!latest) {
      throw new Error("No stable release version found from SpyglassMC API");
    }
    this.logger.info("mcdoc.resolve_version.latest", { version: latest.id });
    return latest.id;
  }

  async fetchSymbols(): Promise<McdocSymbols> {
    this.logger.info("mcdoc.fetch_symbols.start");
    const symbols = await this.api.fetchSymbols();
    await this.storage.saveSymbols(symbols);
    const symbolCount = Object.keys(symbols.mcdoc).length;
    this.logger.info("mcdoc.fetch_symbols.done", { ref: symbols.ref, symbolCount });
    return symbols;
  }

  async fetchVersionData(): Promise<{ version: string; data: McdocVersionData }> {
    const version = await this.resolveVersion();
    this.logger.info("mcdoc.fetch_version_data.start", { version });

    const [blockStates, commands, registries] = await Promise.all([
      this.api.fetchBlockStates(version),
      this.api.fetchCommands(version),
      this.api.fetchRegistries(version),
    ]);

    await this.storage.saveVersionData(version, { blockStates, commands, registries });
    const data: McdocVersionData = { version, blockStates, commands, registries };
    this.logger.info("mcdoc.fetch_version_data.done", { version });
    return { version, data };
  }

  async getSymbols(): Promise<McdocSymbols | undefined> {
    return this.storage.loadSymbols();
  }

  async getVersionData(): Promise<McdocVersionData | undefined> {
    return this.storage.loadVersionData();
  }
}
