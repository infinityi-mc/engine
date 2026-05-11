import { describe, expect, test } from "bun:test";
import {
  McdocFindReferencesTool,
  McdocGetTool,
  McdocGrepFieldsTool,
  McdocListPackagesTool,
  McdocMetaTool,
  McdocSearchTool,
} from "../../src/modules/agent/infrastructure/tools/mcdoc-tools";
import type { McdocRepositoryPort } from "../../src/modules/mcdoc/domain/ports/mcdoc-repository.port";
import { SchemaNotFoundError, UnsafeRegexError } from "../../src/modules/mcdoc/domain/errors/mcdoc.errors";
import { noopLogger } from "../../src/shared/observability/logger.port";

function fakeRepo(overrides: Partial<McdocRepositoryPort> = {}): McdocRepositoryPort {
  const defaults: McdocRepositoryPort = {
    meta: () => ({ ref: "fake-ref", schemaCount: 2, builtAt: "2025-01-01T00:00:00.000Z" }),
    listPackages: (prefix) => ({ prefix: prefix ?? "", children: ["::java"], schemas: [] }),
    getSchema: ((path: string) => ({ path, kind: "struct" })) as unknown as McdocRepositoryPort["getSchema"],
    search: () => [{ path: "::java::A", kind: "struct", score: 100, matchedOn: ["path"] }],
    grepFields: () => [{ path: "::java::A", fieldKey: "x" }],
    findReferences: () => ["::java::B"],
  };
  return { ...defaults, ...overrides };
}

describe("mcdoc agent tools", () => {
  test("McdocMetaTool returns meta as JSON", async () => {
    const tool = new McdocMetaTool(fakeRepo(), noopLogger);
    const result = await tool.execute({});
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.output).ref).toBe("fake-ref");
  });

  test("McdocListPackagesTool accepts string prefix", async () => {
    const tool = new McdocListPackagesTool(fakeRepo(), noopLogger);
    const result = await tool.execute({ prefix: "::java" });
    const parsed = JSON.parse(result.output);
    expect(parsed.children).toEqual(["::java"]);
  });

  test("McdocSearchTool rejects empty query", async () => {
    const tool = new McdocSearchTool(fakeRepo(), noopLogger);
    const result = await tool.execute({ query: "" });
    expect(result.isError).toBe(true);
  });

  test("McdocSearchTool happy path", async () => {
    const tool = new McdocSearchTool(fakeRepo(), noopLogger);
    const result = await tool.execute({ query: "Atlas", limit: 5 });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.hits[0].path).toBe("::java::A");
  });

  test("McdocGetTool requires path", async () => {
    const tool = new McdocGetTool(fakeRepo(), noopLogger);
    const result = await tool.execute({});
    expect(result.isError).toBe(true);
  });

  test("McdocGetTool rejects bad projection", async () => {
    const tool = new McdocGetTool(fakeRepo(), noopLogger);
    const result = await tool.execute({ path: "::java::A", projection: "bogus" });
    expect(result.isError).toBe(true);
  });

  test("McdocGetTool returns SchemaNotFoundError as ToolResult error", async () => {
    const repo = fakeRepo({
      getSchema: (() => {
        throw new SchemaNotFoundError("::java::Missing");
      }) as unknown as McdocRepositoryPort["getSchema"],
    });
    const tool = new McdocGetTool(repo, noopLogger);
    const result = await tool.execute({ path: "::java::Missing" });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("McdocGrepFieldsTool returns UnsafeRegexError as ToolResult error", async () => {
    const repo = fakeRepo({
      grepFields: () => {
        throw new UnsafeRegexError("nested quantifier");
      },
    });
    const tool = new McdocGrepFieldsTool(repo, noopLogger);
    const result = await tool.execute({ pattern: "(a+)+" });
    expect(result.isError).toBe(true);
  });

  test("McdocFindReferencesTool happy path", async () => {
    const tool = new McdocFindReferencesTool(fakeRepo(), noopLogger);
    const result = await tool.execute({ path: "::java::A" });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.output);
    expect(parsed.references).toEqual(["::java::B"]);
  });
});
