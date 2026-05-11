import type {
  FieldSummary,
  RawField,
  RawSchemaEntry,
  SchemaFieldsOnly,
  SchemaSummary,
} from "../domain/types/mcdoc.types";
import { firstLine } from "./indexer";

/** Build a compact summary view of a schema. Pure. */
export function projectSummary(path: string, entry: RawSchemaEntry): SchemaSummary {
  const summary: Mutable<SchemaSummary> = {
    path,
    kind: entry.kind,
  };

  if (Array.isArray(entry.attributes) && entry.attributes.length > 0) {
    summary.attributes = entry.attributes;
  }

  const topDesc = (entry as { desc?: unknown }).desc;
  if (typeof topDesc === "string") {
    summary.descFirstLine = firstLine(topDesc);
  }

  if (entry.kind === "struct" && Array.isArray(entry.fields)) {
    summary.fieldSummary = summarizeFields(entry.fields);
  } else if (entry.kind === "union" && Array.isArray(entry.members)) {
    summary.memberCount = entry.members.length;
  } else if (entry.kind === "enum" && Array.isArray(entry.values)) {
    summary.valueCount = entry.values.length;
  } else if (entry.kind === "template" && entry.child) {
    const child = entry.child as { fields?: readonly RawField[] };
    if (Array.isArray(child.fields)) {
      summary.fieldSummary = summarizeFields(child.fields);
    }
  }

  return summary;
}

export function projectFieldsOnly(path: string, entry: RawSchemaEntry): SchemaFieldsOnly {
  const fields = entry.kind === "struct" && Array.isArray(entry.fields)
    ? entry.fields
    : entry.kind === "template" && entry.child
      ? ((entry.child as { fields?: readonly RawField[] }).fields ?? [])
      : [];

  return { path, fields: summarizeFields(fields) };
}

function summarizeFields(fields: readonly RawField[]): FieldSummary[] {
  const out: FieldSummary[] = [];

  for (const field of fields) {
    if (field.kind !== "pair") continue; // skip spread/other
    if (typeof field.key !== "string") continue; // skip dynamic keys

    const type = field.type;
    const typeKind = type?.kind ?? "unknown";
    const refPath = type?.kind === "reference" && typeof type.path === "string"
      ? type.path
      : type?.kind === "list" && type.item?.kind === "reference" && typeof type.item.path === "string"
        ? type.item.path
        : undefined;

    out.push({
      key: field.key,
      typeKind: type?.kind === "list" && type.item ? `list<${type.item.kind}>` : typeKind,
      ...(refPath ? { refPath } : {}),
      optional: field.optional === true,
      ...(field.desc ? { descFirstLine: firstLine(field.desc) } : {}),
    });
  }

  return out;
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] };
