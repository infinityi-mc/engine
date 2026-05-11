import { describe, expect, test } from "bun:test";
import { projectFieldsOnly, projectSummary } from "../../src/modules/mcdoc/application/projection";
import { fixtureMcdoc } from "./fixtures";

describe("mcdoc projection", () => {
  test("summary of a struct lists fields with type kinds and refs", () => {
    const summary = projectSummary("::java::assets::atlas::Atlas", fixtureMcdoc["::java::assets::atlas::Atlas"]!);
    expect(summary.kind).toBe("struct");
    expect(summary.fieldSummary).toBeDefined();
    const sources = summary.fieldSummary!.find((f) => f.key === "sources");
    expect(sources).toBeDefined();
    expect(sources?.typeKind).toBe("list<reference>");
    expect(sources?.refPath).toBe("::java::assets::atlas::SpriteSource");
    expect(sources?.descFirstLine).toBe("List of sprite sources.");
  });

  test("summary of a union reports memberCount", () => {
    const summary = projectSummary("::java::assets::atlas::SpriteSource", fixtureMcdoc["::java::assets::atlas::SpriteSource"]!);
    expect(summary.kind).toBe("union");
    expect(summary.memberCount).toBe(2);
    expect(summary.fieldSummary).toBeUndefined();
  });

  test("summary of an enum reports valueCount", () => {
    const summary = projectSummary("::java::assets::atlas::SpriteSourceType", fixtureMcdoc["::java::assets::atlas::SpriteSourceType"]!);
    expect(summary.kind).toBe("enum");
    expect(summary.valueCount).toBe(2);
  });

  test("summary of a template extracts child struct fields", () => {
    const summary = projectSummary("::java::data::recipe::Recipe", fixtureMcdoc["::java::data::recipe::Recipe"]!);
    expect(summary.kind).toBe("template");
    expect(summary.fieldSummary).toBeDefined();
    expect(summary.fieldSummary!.map((f) => f.key).sort()).toEqual(["ingredients", "type"]);
  });

  test("fields-only is leaner than summary", () => {
    const fields = projectFieldsOnly("::java::assets::atlas::Atlas", fixtureMcdoc["::java::assets::atlas::Atlas"]!);
    expect(fields.path).toBe("::java::assets::atlas::Atlas");
    expect(fields.fields).toHaveLength(1);
    expect(fields.fields[0]?.key).toBe("sources");
  });

  test("optional fields are flagged", () => {
    const summary = projectSummary("::java::assets::atlas::FilterPattern", fixtureMcdoc["::java::assets::atlas::FilterPattern"]!);
    expect(summary.fieldSummary?.every((f) => f.optional)).toBe(true);
  });
});
