import { describe, expect, test } from "bun:test";
import { buildIndex } from "../../src/modules/mcdoc/application/indexer";
import { search } from "../../src/modules/mcdoc/application/search";
import { fixtureMcdoc, fixtureRef } from "./fixtures";

const idx = buildIndex(fixtureRef, fixtureMcdoc);

describe("mcdoc search", () => {
  test("exact last-segment match ranks highest", () => {
    const hits = search(idx, { query: "Atlas" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe("::java::assets::atlas::Atlas");
    expect(hits[0]?.matchedOn).toContain("path");
  });

  test("field key match contributes to score", () => {
    const hits = search(idx, { query: "pattern" });
    const filter = hits.find((h) => h.path === "::java::assets::atlas::Filter");
    expect(filter).toBeDefined();
    expect(filter?.matchedOn).toContain("field");
  });

  test("description match contributes when no name overlap", () => {
    const hits = search(idx, { query: "sprite" });
    const atlas = hits.find((h) => h.path === "::java::assets::atlas::Atlas");
    expect(atlas).toBeDefined();
  });

  test("kind filter excludes mismatches", () => {
    const all = search(idx, { query: "atlas" });
    const onlyEnums = search(idx, { query: "atlas", kind: "enum" });
    expect(all.some((h) => h.kind === "struct")).toBe(true);
    expect(onlyEnums.every((h) => h.kind === "enum")).toBe(true);
  });

  test("package filter narrows results", () => {
    const hits = search(idx, { query: "recipe", package: "::java::data" });
    expect(hits.every((h) => h.path.startsWith("::java::data"))).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
  });

  test("limit caps result count", () => {
    const hits = search(idx, { query: "a", limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  test("empty query returns no hits", () => {
    expect(search(idx, { query: "" })).toEqual([]);
  });
});
