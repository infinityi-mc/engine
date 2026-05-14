import { describe, expect, test } from "bun:test";
import { McdocService } from "../../src/modules/mcdoc/application/mcdoc.service";
import type { McdocApiPort } from "../../src/modules/mcdoc/domain/ports/mcdoc-api.port";
import type { McdocEmbeddingPort } from "../../src/modules/mcdoc/domain/ports/mcdoc-embedding.port";
import type { McdocLlmPort } from "../../src/modules/mcdoc/domain/ports/mcdoc-llm.port";
import type { McdocStoragePort } from "../../src/modules/mcdoc/domain/ports/mcdoc-storage.port";
import type { McdocSymbols, McdocVersion, McdocVersionData } from "../../src/modules/mcdoc/domain/types/mcdoc";
import type { McdocRagIndex } from "../../src/modules/mcdoc/domain/types/mcdoc-rag";
import { noopLogger } from "../../src/shared/observability/logger.port";

class MemoryMcdocStorage implements McdocStoragePort {
  symbols: McdocSymbols | undefined;
  versions: readonly McdocVersion[] | undefined;
  versionData: McdocVersionData | undefined;
  ragIndex: McdocRagIndex | undefined;

  async saveSymbols(symbols: McdocSymbols): Promise<void> {
    this.symbols = symbols;
  }

  async loadSymbols(): Promise<McdocSymbols | undefined> {
    return this.symbols;
  }

  async saveVersions(versions: readonly McdocVersion[]): Promise<void> {
    this.versions = versions;
  }

  async loadVersions(): Promise<readonly McdocVersion[] | undefined> {
    return this.versions;
  }

  async saveVersionData(version: string, data: Omit<McdocVersionData, "version">): Promise<void> {
    this.versionData = { version, ...data };
  }

  async loadVersionData(): Promise<McdocVersionData | undefined> {
    return this.versionData;
  }

  async saveRagIndex(index: McdocRagIndex): Promise<void> {
    this.ragIndex = index;
  }

  async loadRagIndex(): Promise<McdocRagIndex | undefined> {
    return this.ragIndex;
  }
}

class CountingEmbedder implements McdocEmbeddingPort {
  readonly model = "gemini-embedding-2";
  documentCalls = 0;
  queryCalls = 0;

  async embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    this.documentCalls++;
    return texts.map((_, index) => [index + 1, 0, 0]);
  }

  async embedQuery(_text: string): Promise<readonly number[]> {
    this.queryCalls++;
    return [1, 0, 0];
  }
}

class ThrowingEmbedder implements McdocEmbeddingPort {
  readonly model = "gemini-embedding-2";

  async embedDocuments(_texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    throw new Error("embedding unavailable");
  }

  async embedQuery(_text: string): Promise<readonly number[]> {
    return [1, 0, 0];
  }
}

function fakeLlm(): McdocLlmPort & { requests: Parameters<McdocLlmPort["complete"]>[0][] } {
  const requests: Parameters<McdocLlmPort["complete"]>[0][] = [];
  return {
    requests,
    complete: async (request) => {
      requests.push(request);
      return {
        content: "Use powered=true. Source 1.",
        reasoning: "",
        stopReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
        model: "test-model",
        provider: "test-provider",
      };
    },
  };
}

function fakeApi(): McdocApiPort {
  return {
    fetchVersions: async () => [],
    fetchSymbols: async () => ({ ref: "symbols-ref", mcdoc: {} }),
    fetchBlockStates: async (version) => ({ [`stone_${version}`]: [{ powered: ["true", "false"] }, { powered: "false" }] }),
    fetchCommands: async () => ({}),
    fetchRegistries: async () => ({ biome: ["plains"] }),
  };
}

describe("McdocService RAG cache", () => {
  test("preserves fetch behavior when no embedder is configured", async () => {
    const storage = new MemoryMcdocStorage();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version: "1.21.8" }) },
      logger: noopLogger,
      refreshDebounceMs: 0,
    });

    const result = await service.fetchVersionData();

    expect(result.version).toBe("1.21.8");
    expect(storage.ragIndex).toBeUndefined();
  });

  test("does not re-embed documents when fetched version is unchanged", async () => {
    const storage = new MemoryMcdocStorage();
    const embedder = new CountingEmbedder();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version: "1.21.8" }) },
      logger: noopLogger,
      embedder,
      refreshDebounceMs: 0,
    });

    await service.fetchVersionData();
    await service.fetchVersionData();
    await service.searchRag("stone_1.21.8");

    expect(embedder.documentCalls).toBe(1);
    expect(embedder.queryCalls).toBe(0);
    expect(storage.ragIndex?.manifest.storageFormat).toBe("f32-binary");
    expect(storage.ragIndex?.manifest.vectorDimensions).toBe(3);
  });

  test("re-embeds documents when fetched version changes", async () => {
    let version = "1.21.8";
    const storage = new MemoryMcdocStorage();
    const embedder = new CountingEmbedder();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version }) },
      logger: noopLogger,
      embedder,
      refreshDebounceMs: 0,
    });

    await service.fetchVersionData();
    await service.searchRag("stone_1.21.8");
    version = "1.21.9";
    await service.fetchVersionData();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(embedder.documentCalls).toBe(2);
  });

  test("uses stale index during debounced background refresh", async () => {
    let version = "1.21.8";
    const storage = new MemoryMcdocStorage();
    const embedder = new CountingEmbedder();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version }) },
      logger: noopLogger,
      embedder,
      refreshDebounceMs: 25,
    });

    await service.fetchVersionData();
    await service.searchRag("stone_1.21.8");
    version = "1.21.9";
    await service.fetchVersionData();
    await service.searchRag("stone_1.21.8");

    expect(embedder.documentCalls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 35));
  });

  test("rapid fetch calls do not orphan refresh promise", async () => {
    let version = "1.21.8";
    const storage = new MemoryMcdocStorage();
    const embedder = new CountingEmbedder();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version }) },
      logger: noopLogger,
      embedder,
      refreshDebounceMs: 25,
    });

    await service.fetchVersionData();
    await service.searchRag("stone_1.21.8");
    version = "1.21.9";
    service.fetchVersionData();
    version = "1.22.0";
    service.fetchVersionData();
    await new Promise((resolve) => setTimeout(resolve, 35));

    const results = await service.searchRag("stone_1.22.0");
    expect(results.length).toBeGreaterThan(0);
    expect(embedder.documentCalls).toBe(2);
  });

  test("fetch succeeds when background embedding fails", async () => {
    const storage = new MemoryMcdocStorage();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version: "1.21.8" }) },
      logger: noopLogger,
      embedder: new ThrowingEmbedder(),
      refreshDebounceMs: 0,
    });

    const result = await service.fetchVersionData();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(result.version).toBe("1.21.8");
    expect(storage.ragIndex).toBeUndefined();
  });

  test("answerRag searches context and calls LLM with citations", async () => {
    const storage = new MemoryMcdocStorage();
    const embedder = new CountingEmbedder();
    const llm = fakeLlm();
    const service = new McdocService({
      api: fakeApi(),
      storage,
      config: { getMcdocConfig: () => ({ version: "1.21.8" }) },
      logger: noopLogger,
      embedder,
      llmService: llm,
      answerOptions: { temperature: 0.2, maxTokens: 64, systemPrompt: "Use only test mcdoc context." },
      refreshDebounceMs: 0,
    });

    await service.fetchVersionData();
    const result = await service.answerRag("What states does stone_1.21.8 have?", undefined, { maxTokens: 32 });

    expect(result.answer).toBe("Use powered=true. Source 1.");
    expect(result.citations[0]!.title).toContain("stone_1.21.8");
    expect(llm.requests[0]!.temperature).toBe(0.2);
    expect(llm.requests[0]!.maxTokens).toBe(32);
    expect(llm.requests[0]!.messages[0]!.content).toBe("Use only test mcdoc context.");
    expect(llm.requests[0]!.messages[1]!.content).toContain("stone_1.21.8");
  });
});
