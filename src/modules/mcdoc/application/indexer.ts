import type {
  DerivedIndex,
  GrepFieldMatch,
  RawField,
  RawSchemaEntry,
  RawType,
  SchemaKind,
} from "../domain/types/mcdoc.types";

const PATH_SEP = "::";

/**
 * Build a {@link DerivedIndex} from the raw mcdoc map. Pure; no I/O.
 */
export function buildIndex(
  ref: string,
  mcdoc: Record<string, RawSchemaEntry>,
  now: () => Date = () => new Date(),
): DerivedIndex {
  const paths = Object.keys(mcdoc).sort();
  const kinds: Record<string, SchemaKind> = {};
  const packages: Record<string, Set<string>> = {};
  const packageSchemas: Record<string, string[]> = {};
  const nameIndex: Record<string, Set<string>> = {};
  const fieldIndex: Record<string, GrepFieldMatch[]> = {};
  const descIndex: Record<string, Set<string>> = {};
  const reverseRefs: Record<string, Set<string>> = {};

  for (const path of paths) {
    const entry = mcdoc[path];
    if (!entry) continue;

    kinds[path] = entry.kind;

    indexPackageHierarchy(path, packages, packageSchemas);
    indexNameTokens(path, nameIndex);
    collectFieldsAndRefs(path, entry, fieldIndex, descIndex, reverseRefs);
  }

  return {
    meta: {
      ref,
      schemaCount: paths.length,
      builtAt: now().toISOString(),
    },
    paths,
    packages: setMapToSortedArray(packages),
    packageSchemas,
    nameIndex: setMapToSortedArray(nameIndex),
    fieldIndex,
    descIndex: setMapToSortedArray(descIndex),
    reverseRefs: setMapToSortedArray(reverseRefs),
    kinds,
  };
}

function indexPackageHierarchy(
  path: string,
  packages: Record<string, Set<string>>,
  packageSchemas: Record<string, string[]>,
): void {
  const segments = path.split(PATH_SEP).filter((s) => s.length > 0);
  if (segments.length === 0) return;

  // Last segment is the schema name; everything before is the package.
  const parentPkg = PATH_SEP + segments.slice(0, -1).join(PATH_SEP);
  (packageSchemas[parentPkg] ??= []).push(path);

  // Build the chain of package -> immediate sub-package.
  for (let i = 1; i < segments.length; i++) {
    const parent = PATH_SEP + segments.slice(0, i).join(PATH_SEP);
    const child = PATH_SEP + segments.slice(0, i + 1).join(PATH_SEP);
    // Only register children that are themselves packages (i.e. not the leaf schema).
    if (i < segments.length - 1) {
      (packages[parent] ??= new Set()).add(child);
    }
  }
  // Ensure root has top-level packages.
  if (segments.length >= 1) {
    const top = PATH_SEP + segments[0]!;
    if (segments.length > 1) {
      (packages[""] ??= new Set()).add(top);
    }
  }
}

function indexNameTokens(path: string, nameIndex: Record<string, Set<string>>): void {
  for (const tok of tokenize(path)) {
    (nameIndex[tok] ??= new Set()).add(path);
  }
}

function collectFieldsAndRefs(
  path: string,
  entry: RawSchemaEntry,
  fieldIndex: Record<string, GrepFieldMatch[]>,
  descIndex: Record<string, Set<string>>,
  reverseRefs: Record<string, Set<string>>,
): void {
  // Description tokens (top-level + per-field) feed descIndex.
  const descValue = (entry as { desc?: unknown }).desc;
  const topDesc = typeof descValue === "string" ? descValue : undefined;
  if (topDesc) {
    for (const tok of tokenize(topDesc)) {
      (descIndex[tok] ??= new Set()).add(path);
    }
  }

  if (entry.kind === "struct" && Array.isArray(entry.fields)) {
    for (const field of entry.fields) {
      indexField(path, field, fieldIndex, descIndex, reverseRefs);
    }
  } else if (entry.kind === "union" && Array.isArray(entry.members)) {
    for (const member of entry.members) {
      walkType(path, member as RawType, reverseRefs);
    }
  } else if (entry.kind === "template" && entry.child) {
    walkType(path, entry.child as RawType, reverseRefs);
    // Also walk fields if the child is a struct.
    const child = entry.child as { fields?: readonly RawField[] };
    if (Array.isArray(child.fields)) {
      for (const f of child.fields) {
        indexField(path, f, fieldIndex, descIndex, reverseRefs);
      }
    }
  }
}

function indexField(
  path: string,
  field: RawField,
  fieldIndex: Record<string, GrepFieldMatch[]>,
  descIndex: Record<string, Set<string>>,
  reverseRefs: Record<string, Set<string>>,
): void {
  if (field.desc) {
    for (const tok of tokenize(field.desc)) {
      (descIndex[tok] ??= new Set()).add(path);
    }
  }

  if (field.kind === "pair" && typeof field.key === "string") {
    const match: GrepFieldMatch = {
      path,
      fieldKey: field.key,
      ...(field.desc ? { descFirstLine: firstLine(field.desc) } : {}),
    };
    (fieldIndex[field.key] ??= []).push(match);

    for (const tok of tokenize(field.key)) {
      (descIndex[tok] ??= new Set()).add(path);
    }
  }

  if (field.type) {
    walkType(path, field.type, reverseRefs);
  }
}

function walkType(
  ownerPath: string,
  type: RawType | undefined,
  reverseRefs: Record<string, Set<string>>,
): void {
  if (!type || typeof type !== "object") return;

  if (type.kind === "reference" && typeof type.path === "string") {
    (reverseRefs[type.path] ??= new Set()).add(ownerPath);
    return;
  }

  if (type.kind === "list" && type.item) {
    walkType(ownerPath, type.item, reverseRefs);
    return;
  }

  if (type.kind === "struct") {
    const fields = (type as { fields?: readonly RawField[] }).fields;
    if (Array.isArray(fields)) {
      for (const f of fields) {
        if (f.type) walkType(ownerPath, f.type, reverseRefs);
      }
    }
    return;
  }

  // Generic fallback: walk any nested objects/arrays for `kind: "reference"` entries.
  for (const value of Object.values(type)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          walkType(ownerPath, item as RawType, reverseRefs);
        }
      }
    } else if (value && typeof value === "object") {
      walkType(ownerPath, value as RawType, reverseRefs);
    }
  }
}

const TOKEN_SPLIT = /[\s:_/\-.,()[\]{}<>"`'!?]+/g;

export function tokenize(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.toLowerCase().split(TOKEN_SPLIT)) {
    if (raw.length >= 2) out.push(raw);
  }
  return out;
}

export function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? text : text.slice(0, nl);
}

function setMapToSortedArray(map: Record<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = [...v].sort();
  }
  return out;
}
