import { describe, expect, test } from "bun:test";
import { buildMcdocRagDocuments } from "../../src/modules/mcdoc/application/rag-index-builder";
import type { McdocSymbols, McdocVersionData } from "../../src/modules/mcdoc/domain/types/mcdoc";

describe("buildMcdocRagDocuments", () => {
  test("indexes symbols with referenced fields", () => {
    const symbols: McdocSymbols = {
      ref: "abc",
      mcdoc: {
        "::java::Example": {
          kind: "struct",
          fields: [
            {
              kind: "pair",
              key: "target",
              desc: "Target reference.",
              type: { kind: "reference", path: "::java::Other" },
            },
          ],
        },
      },
    };

    const documents = buildMcdocRagDocuments({ symbols });

    expect(documents.map((document) => document.id)).toEqual([
      "symbol:::java::Example",
      "symbol-field:::java::Example:target",
    ]);
    expect(documents[1]!.metadata.references).toEqual(["::java::Other"]);
  });

  test("flattens executable command paths", () => {
    const versionData: McdocVersionData = {
      version: "1.21.8",
      blockStates: {},
      registries: {},
      commands: {
        type: "root",
        children: {
          time: {
            type: "literal",
            children: {
              set: {
                type: "literal",
                children: {
                  value: { type: "argument", parser: "brigadier:integer", executable: true },
                },
              },
            },
          },
        },
      },
    };

    const documents = buildMcdocRagDocuments({ versionData });

    expect(documents.some((document) => document.metadata.commandPath === "/time set value")).toBe(true);
  });

  test("indexes block states with defaults", () => {
    const versionData: McdocVersionData = {
      version: "1.21.8",
      commands: {},
      registries: {},
      blockStates: {
        acacia_button: [
          { face: ["floor", "wall"], powered: ["true", "false"] },
          { face: "wall", powered: "false" },
        ],
      },
    };

    const documents = buildMcdocRagDocuments({ versionData });

    expect(documents[0]!.text).toContain("powered: true, false (default false)");
  });
});
