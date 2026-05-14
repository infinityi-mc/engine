import { unlink } from "node:fs/promises";
import { z } from "zod";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { McdocApiPort } from "../../domain/ports/mcdoc-api.port";
import type { McdocVersion, McdocSymbols } from "../../domain/types/mcdoc";

const BASE_URL = "https://api.spyglassmc.com";

const SpyglassMcVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["release", "snapshot"]),
  stable: z.boolean(),
  data_version: z.number(),
  protocol_version: z.number(),
  data_pack_version: z.number(),
  data_pack_version_minor: z.number(),
  resource_pack_version: z.number(),
  resource_pack_version_minor: z.number(),
  build_time: z.string(),
  release_time: z.string(),
  sha1: z.string(),
});

const SpyglassMcVersionsSchema = z.array(SpyglassMcVersionSchema);

const SpyglassMcSymbolEntrySchema = z.object({ kind: z.string() }).passthrough();

const SpyglassMcSymbolsSchema = z.object({
  ref: z.string(),
  mcdoc: z.record(z.string(), SpyglassMcSymbolEntrySchema),
});

export interface SpyglassMcApiAdapterInput {
  readonly logger: LoggerPort;
  readonly tempDir?: string;
}

export class SpyglassMcApiAdapter implements McdocApiPort {
  private readonly logger: LoggerPort;
  private readonly tempDir: string;

  constructor(input: SpyglassMcApiAdapterInput) {
    this.logger = input.logger;
    this.tempDir = input.tempDir ?? "data/temp";
  }

  async fetchVersions(): Promise<McdocVersion[]> {
    const raw = await this.fetchJson<unknown>(`${BASE_URL}/mcje/versions`);
    const parsed = SpyglassMcVersionsSchema.parse(raw);

    return parsed.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      stable: v.stable,
      dataVersion: v.data_version,
      protocolVersion: v.protocol_version,
      dataPackVersion: v.data_pack_version,
      dataPackVersionMinor: v.data_pack_version_minor,
      resourcePackVersion: v.resource_pack_version,
      resourcePackVersionMinor: v.resource_pack_version_minor,
      buildTime: v.build_time,
      releaseTime: v.release_time,
      sha1: v.sha1,
    }));
  }

  async fetchSymbols(): Promise<McdocSymbols> {
    const raw = await this.fetchLargeJson<unknown>(`${BASE_URL}/vanilla-mcdoc/symbols`);
    const parsed = SpyglassMcSymbolsSchema.parse(raw);

    return {
      ref: parsed.ref,
      mcdoc: parsed.mcdoc,
    };
  }

  async fetchBlockStates(version: string): Promise<unknown> {
    return this.fetchLargeJson<unknown>(
      `${BASE_URL}/mcje/versions/${encodeURIComponent(version)}/block_states`,
    );
  }

  async fetchCommands(version: string): Promise<unknown> {
    return this.fetchLargeJson<unknown>(
      `${BASE_URL}/mcje/versions/${encodeURIComponent(version)}/commands`,
    );
  }

  async fetchRegistries(version: string): Promise<unknown> {
    return this.fetchLargeJson<unknown>(
      `${BASE_URL}/mcje/versions/${encodeURIComponent(version)}/registries`,
    );
  }

  private async fetchJson<T>(url: string): Promise<T> {
    this.logger.debug("mcdoc.api.fetch", { url });

    const response = await fetch(url);
    if (!response.ok) {
      this.logger.error("mcdoc.api.fetch_failed", { url, status: response.status });
      throw new Error(`SpyglassMC API request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  private async fetchLargeJson<T>(url: string): Promise<T> {
    this.logger.debug("mcdoc.api.fetch_large", { url });

    const response = await fetch(url);
    if (!response.ok) {
      this.logger.error("mcdoc.api.fetch_failed", { url, status: response.status });
      throw new Error(`SpyglassMC API request failed: ${response.status} ${response.statusText}`);
    }

    const tempPath = `${this.tempDir}/mcdoc_${Date.now()}_${Math.random().toString(36).slice(2)}.json`;
    await Bun.write(tempPath, response);

    try {
      const content = await Bun.file(tempPath).text();
      return JSON.parse(content) as T;
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}
