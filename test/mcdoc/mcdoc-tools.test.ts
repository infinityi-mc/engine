import { describe, expect, test } from "bun:test";
import { McdocAnswerTool, McdocRetrieveTool, McdocSearchTool } from "../../src/modules/agent/infrastructure/tools/mcdoc-tools";
import type { McdocService } from "../../src/modules/mcdoc/application/mcdoc.service";

describe("mcdoc agent tools", () => {
  test("mcdoc_search validates query", async () => {
    const service = {} as McdocService;
    const tool = new McdocSearchTool(service);

    const result = await tool.execute({ query: "" });

    expect(result.isError).toBe(true);
  });

  test("mcdoc_search rejects invalid filter source", async () => {
    const service = {} as McdocService;
    const tool = new McdocSearchTool(service);

    const result = await tool.execute({ query: "biome", filters: { source: "items" } });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid filters.source");
  });

  test("mcdoc_search rejects invalid filter kind", async () => {
    const service = {} as McdocService;
    const tool = new McdocSearchTool(service);

    const result = await tool.execute({ query: "biome", filters: { kind: "item" } });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Invalid filters.kind");
  });

  test("mcdoc_retrieve returns service document", async () => {
    const service = {
      retrieveRagDocument: async () => ({
        id: "registry:biome",
        title: "Minecraft registry biome",
        text: "Registry: biome",
        metadata: { source: "registries", kind: "registry", jsonPath: "$.biome", registry: "biome" },
      }),
    } as unknown as McdocService;
    const tool = new McdocRetrieveTool(service);

    const result = await tool.execute({ id: "registry:biome" });

    expect(JSON.parse(result.output).document.id).toBe("registry:biome");
  });

  test("mcdoc_answer returns service answer", async () => {
    const service = {
      answerRag: async () => ({
        answer: "Use powered=true.",
        citations: [{ source: "block_states", jsonPath: "$.stone", title: "Minecraft block state stone" }],
      }),
    } as unknown as McdocService;
    const tool = new McdocAnswerTool(service);

    const result = await tool.execute({ question: "What states does stone have?" });

    expect(JSON.parse(result.output).answer).toBe("Use powered=true.");
  });
});
