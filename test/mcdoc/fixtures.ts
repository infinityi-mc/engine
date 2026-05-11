import type { RawSchemaEntry } from "../../src/modules/mcdoc/domain/types/mcdoc.types";

/** Tiny synthetic mcdoc map exercising struct/enum/union/template + references. */
export const fixtureRef = "test-ref-0000";

export const fixtureMcdoc: Record<string, RawSchemaEntry> = {
  "::java::assets::atlas::Atlas": {
    kind: "struct",
    fields: [
      {
        kind: "pair",
        key: "sources",
        desc: "List of sprite sources.",
        type: {
          kind: "list",
          item: { kind: "reference", path: "::java::assets::atlas::SpriteSource" },
        },
      },
    ],
  },
  "::java::assets::atlas::SpriteSource": {
    kind: "union",
    members: [
      { kind: "reference", path: "::java::assets::atlas::Single" },
      { kind: "reference", path: "::java::assets::atlas::Filter" },
    ],
  },
  "::java::assets::atlas::Single": {
    kind: "struct",
    fields: [
      {
        kind: "pair",
        key: "resource",
        desc: "Sprite identifier.",
        type: { kind: "string" },
      },
    ],
  },
  "::java::assets::atlas::Filter": {
    kind: "struct",
    fields: [
      {
        kind: "pair",
        key: "pattern",
        desc: "Pattern to remove sprites.",
        type: { kind: "reference", path: "::java::assets::atlas::FilterPattern" },
      },
    ],
  },
  "::java::assets::atlas::FilterPattern": {
    kind: "struct",
    fields: [
      { kind: "pair", key: "namespace", optional: true, type: { kind: "string" } },
      { kind: "pair", key: "path", optional: true, type: { kind: "string" } },
    ],
  },
  "::java::assets::atlas::SpriteSourceType": {
    kind: "enum",
    enumKind: "string",
    values: [
      { identifier: "Single", value: "single" },
      { identifier: "Filter", value: "filter" },
    ],
  },
  "::java::data::recipe::Recipe": {
    kind: "template",
    child: {
      kind: "struct",
      fields: [
        { kind: "pair", key: "type", type: { kind: "string" } },
        {
          kind: "pair",
          key: "ingredients",
          type: {
            kind: "list",
            item: { kind: "reference", path: "::java::data::recipe::Ingredient" },
          },
        },
      ],
    },
  },
  "::java::data::recipe::Ingredient": {
    kind: "struct",
    fields: [
      { kind: "pair", key: "item", type: { kind: "string" } },
    ],
  },
};
