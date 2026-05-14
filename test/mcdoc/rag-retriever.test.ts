import { describe, expect, test } from "bun:test";
import { McdocRagRetriever } from "../../src/modules/mcdoc/application/rag-retriever";
import type { McdocEmbeddingPort } from "../../src/modules/mcdoc/domain/ports/mcdoc-embedding.port";
import type { McdocRagIndex } from "../../src/modules/mcdoc/domain/types/mcdoc-rag";

const index: McdocRagIndex = {
  manifest: {
    indexVersion: 1,
    embeddingModel: "test",
    storageFormat: "f32-binary",
    vectorDimensions: 0,
    generatedAt: "2026-01-01T00:00:00.000Z",
    documentCount: 2,
    vectorCount: 0,
  },
  vectors: { dimensions: 0, values: new Float32Array() },
  documents: [
    {
      id: "block-state:acacia_button",
      title: "Minecraft block state acacia_button",
      text: "Block: acacia_button\nProperties:\nface: floor, wall\npowered: true, false",
      metadata: { source: "block_states", kind: "block_state", jsonPath: "$.acacia_button", blockId: "acacia_button" },
    },
    {
      id: "registry:biome",
      title: "Minecraft registry biome",
      text: "Registry: biome\nEntries: plains, desert",
      metadata: { source: "registries", kind: "registry", jsonPath: "$.biome", registry: "biome" },
    },
  ],
};

describe("McdocRagRetriever", () => {
  test("ranks exact technical matches", async () => {
    const retriever = new McdocRagRetriever(index);

    const results = await retriever.search("acacia_button powered");

    expect(results[0]!.document.id).toBe("block-state:acacia_button");
  });

  test("applies metadata filters", async () => {
    const retriever = new McdocRagRetriever(index);

    const results = await retriever.search("biome", { source: "registries" });

    expect(results.map((result) => result.document.metadata.source)).toEqual(["registries"]);
  });

  test("throws when query vector dimensions do not match the index", async () => {
    const embedder: McdocEmbeddingPort = {
      model: "test",
      embedDocuments: async () => [],
      embedQuery: async () => [1, 0],
    };
    const mismatchedIndex: McdocRagIndex = {
      ...index,
      manifest: { ...index.manifest, vectorDimensions: 3, vectorCount: 2 },
      vectors: { dimensions: 3, values: new Float32Array([1, 0, 0, 0, 1, 0]) },
    };
    const retriever = new McdocRagRetriever(mismatchedIndex, embedder);

    await expect(retriever.search("acacia_button")).rejects.toThrow("RAG query vector dimension mismatch");
  });
});
