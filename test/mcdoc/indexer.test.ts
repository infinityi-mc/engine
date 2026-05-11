import { describe, expect, test } from "bun:test";
import { buildIndex, firstLine, tokenize } from "../../src/modules/mcdoc/application/indexer";
import { fixtureMcdoc, fixtureRef } from "./fixtures";

describe("mcdoc indexer", () => {
  test("tokenize splits on separators and lowercases", () => {
    expect(tokenize("::java::Assets::Atlas")).toEqual(["java", "assets", "atlas"]);
    expect(tokenize("hello world_foo")).toEqual(["hello", "world", "foo"]);
    expect(tokenize("a")).toEqual([]); // too short
  });

  test("firstLine truncates at newline", () => {
    expect(firstLine("hello\nworld")).toBe("hello");
    expect(firstLine("single")).toBe("single");
  });

  test("buildIndex captures meta + paths sorted", () => {
    const idx = buildIndex(fixtureRef, fixtureMcdoc);
    expect(idx.meta.ref).toBe(fixtureRef);
    expect(idx.meta.schemaCount).toBe(Object.keys(fixtureMcdoc).length);
    expect(idx.paths).toEqual([...Object.keys(fixtureMcdoc)].sort());
  });

  test("buildIndex captures kinds", () => {
    const idx = buildIndex(fixtureRef, fixtureMcdoc);
    expect(idx.kinds["::java::assets::atlas::Atlas"]).toBe("struct");
    expect(idx.kinds["::java::assets::atlas::SpriteSource"]).toBe("union");
    expect(idx.kinds["::java::assets::atlas::SpriteSourceType"]).toBe("enum");
    expect(idx.kinds["::java::data::recipe::Recipe"]).toBe("template");
  });

  test("buildIndex builds package hierarchy with leaf schemas", () => {
    const idx = buildIndex(fixtureRef, fixtureMcdoc);
    expect(idx.packages[""]).toContain("::java");
    expect(idx.packages["::java"]).toContain("::java::assets");
    expect(idx.packages["::java::assets"]).toContain("::java::assets::atlas");
    expect(idx.packageSchemas["::java::assets::atlas"]).toContain("::java::assets::atlas::Atlas");
    expect(idx.packageSchemas["::java::data::recipe"]).toContain("::java::data::recipe::Recipe");
  });

  test("buildIndex indexes field keys", () => {
    const idx = buildIndex(fixtureRef, fixtureMcdoc);
    const sourcesHits = idx.fieldIndex["sources"];
    expect(sourcesHits).toBeDefined();
    expect(sourcesHits?.some((h) => h.path === "::java::assets::atlas::Atlas")).toBe(true);
    expect(sourcesHits?.[0]?.descFirstLine).toBe("List of sprite sources.");

    const patternHits = idx.fieldIndex["pattern"];
    expect(patternHits?.some((h) => h.path === "::java::assets::atlas::Filter")).toBe(true);
  });

  test("buildIndex extracts reverse references through list items and unions", () => {
    const idx = buildIndex(fixtureRef, fixtureMcdoc);
    expect(idx.reverseRefs["::java::assets::atlas::SpriteSource"]).toContain("::java::assets::atlas::Atlas");
    expect(idx.reverseRefs["::java::assets::atlas::Single"]).toContain("::java::assets::atlas::SpriteSource");
    expect(idx.reverseRefs["::java::data::recipe::Ingredient"]).toContain("::java::data::recipe::Recipe");
  });

  test("buildIndex captures name tokens for path search", () => {
    const idx = buildIndex(fixtureRef, fixtureMcdoc);
    expect(idx.nameIndex["atlas"]).toContain("::java::assets::atlas::Atlas");
    expect(idx.nameIndex["ingredient"]).toContain("::java::data::recipe::Ingredient");
  });
});
