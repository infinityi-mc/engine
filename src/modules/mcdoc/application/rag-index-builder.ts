import type { McdocSymbols, McdocVersion, McdocVersionData } from "../domain/types/mcdoc";
import type { McdocRagDocument, McdocRagIndex } from "../domain/types/mcdoc-rag";

const INDEX_VERSION = 1;

export const MCDOC_RAG_INDEX_VERSION = INDEX_VERSION;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
}

function normalizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_./-]+/g, "_");
}

function summarizeJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => collectReferences(item)))];
  }
  if (!isRecord(value)) return [];

  const direct = typeof value.path === "string" ? [value.path] : [];
  const nested = Object.values(value).flatMap((item) => collectReferences(item));
  return [...new Set([...direct, ...nested])];
}

export interface McdocRagBuildInput {
  readonly symbols?: McdocSymbols | undefined;
  readonly versionData?: McdocVersionData | undefined;
  readonly versions?: readonly McdocVersion[] | undefined;
}

export function buildMcdocRagDocuments(input: McdocRagBuildInput): McdocRagDocument[] {
  return [
    ...buildSymbolDocuments(input.symbols),
    ...buildCommandDocuments(input.versionData),
    ...buildRegistryDocuments(input.versionData),
    ...buildBlockStateDocuments(input.versionData),
    ...buildVersionDocuments(input.versions),
  ];
}

export function createVectorStore(vectors: readonly (readonly number[])[]): McdocRagIndex["vectors"] {
  const dimensions = vectors[0]?.length ?? 0;
  const values = new Float32Array(vectors.length * dimensions);

  for (let vectorIndex = 0; vectorIndex < vectors.length; vectorIndex++) {
    const vector = vectors[vectorIndex];
    if (!vector || vector.length !== dimensions) {
      throw new Error(`Embedding vector dimension mismatch at index ${vectorIndex}`);
    }
    values.set(vector, vectorIndex * dimensions);
  }

  return { dimensions, values };
}

function buildSymbolDocuments(symbols: McdocSymbols | undefined): McdocRagDocument[] {
  if (!symbols) return [];

  return Object.entries(symbols.mcdoc).flatMap(([symbolPath, entry]) => {
    const references = collectReferences(entry);
    const fields = Array.isArray(entry.fields) ? entry.fields : [];
    const fieldSummaries = fields
      .filter(isRecord)
      .map((field) => {
        const key = typeof field.key === "string" ? field.key : "<unknown>";
        const desc = typeof field.desc === "string" ? `: ${field.desc}` : "";
        return `${key}${desc}`;
      });

    const symbolDoc: McdocRagDocument = {
      id: `symbol:${normalizeId(symbolPath)}`,
      title: `mcdoc symbol ${symbolPath}`,
      text: compact([
        `Symbol: ${symbolPath}`,
        `Kind: ${entry.kind}`,
        fieldSummaries.length > 0 ? `Fields:\n${fieldSummaries.join("\n")}` : undefined,
        references.length > 0 ? `References: ${references.join(", ")}` : undefined,
      ]),
      metadata: {
        source: "symbols",
        kind: "symbol",
        jsonPath: `$.mcdoc[${JSON.stringify(symbolPath)}]`,
        symbolPath,
        references,
      },
    };

    const fieldDocs = fields.filter(isRecord).map((field, index): McdocRagDocument => {
      const key = typeof field.key === "string" ? field.key : `field_${index}`;
      const desc = typeof field.desc === "string" ? field.desc : undefined;
      const fieldReferences = collectReferences(field);
      return {
        id: `symbol-field:${normalizeId(symbolPath)}:${normalizeId(key)}`,
        title: `mcdoc field ${symbolPath}.${key}`,
        text: compact([
          `Symbol: ${symbolPath}`,
          `Field: ${key}`,
          desc ? `Description: ${desc}` : undefined,
          `Definition: ${summarizeJson(field)}`,
          fieldReferences.length > 0 ? `References: ${fieldReferences.join(", ")}` : undefined,
        ]),
        metadata: {
          source: "symbols",
          kind: "symbol_field",
          jsonPath: `$.mcdoc[${JSON.stringify(symbolPath)}].fields[${index}]`,
          symbolPath,
          references: fieldReferences,
        },
      };
    });

    return [symbolDoc, ...fieldDocs];
  });
}

function buildCommandDocuments(versionData: McdocVersionData | undefined): McdocRagDocument[] {
  if (!versionData || !isRecord(versionData.commands)) return [];
  const root = versionData.commands;
  const children = isRecord(root.children) ? root.children : {};
  return Object.entries(children).flatMap(([name, node]) => buildCommandNode(versionData.version, name, node, [name], `$.children.${name}`));
}

function buildCommandNode(
  version: string,
  name: string,
  node: unknown,
  path: readonly string[],
  jsonPath: string,
): McdocRagDocument[] {
  if (!isRecord(node)) return [];

  const type = typeof node.type === "string" ? node.type : "unknown";
  const parser = typeof node.parser === "string" ? node.parser : undefined;
  const executable = node.executable === true;
  const properties = isRecord(node.properties) ? summarizeJson(node.properties) : undefined;
  const commandPath = `/${path.join(" ")}`;
  const childEntries = isRecord(node.children) ? Object.entries(node.children) : [];

  const ownDoc: McdocRagDocument = {
    id: `command:${normalizeId(commandPath)}`,
    title: `Minecraft command ${commandPath}`,
    text: compact([
      `Command path: ${commandPath}`,
      `Node name: ${name}`,
      `Node type: ${type}`,
      parser ? `Parser: ${parser}` : undefined,
      executable ? "Executable: true" : "Executable: false",
      properties ? `Properties: ${properties}` : undefined,
      childEntries.length > 0 ? `Children: ${childEntries.map(([childName]) => childName).join(", ")}` : undefined,
    ]),
    metadata: {
      source: "commands",
      kind: "command",
      jsonPath,
      version,
      commandPath,
    },
  };

  return [
    ownDoc,
    ...childEntries.flatMap(([childName, childNode]) => buildCommandNode(
      version,
      childName,
      childNode,
      [...path, childName],
      `${jsonPath}.children.${childName}`,
    )),
  ];
}

function buildRegistryDocuments(versionData: McdocVersionData | undefined): McdocRagDocument[] {
  if (!versionData || !isRecord(versionData.registries)) return [];

  return Object.entries(versionData.registries).flatMap(([registry, value]) => {
    const entries = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    const registryDoc: McdocRagDocument = {
      id: `registry:${normalizeId(registry)}`,
      title: `Minecraft registry ${registry}`,
      text: compact([
        `Registry: ${registry}`,
        `Version: ${versionData.version}`,
        `Entries: ${entries.join(", ")}`,
      ]),
      metadata: {
        source: "registries",
        kind: "registry",
        jsonPath: `$.${registry}`,
        version: versionData.version,
        registry,
      },
    };

    const entryDocs = entries.map((entry, index): McdocRagDocument => ({
      id: `registry-entry:${normalizeId(registry)}:${normalizeId(entry)}`,
      title: `Minecraft registry entry ${registry}:${entry}`,
      text: compact([
        `Registry: ${registry}`,
        `Entry: ${entry}`,
        `Version: ${versionData.version}`,
      ]),
      metadata: {
        source: "registries",
        kind: "registry_entry",
        jsonPath: `$.${registry}[${index}]`,
        version: versionData.version,
        registry,
        entryId: entry,
      },
    }));

    return [registryDoc, ...entryDocs];
  });
}

function buildBlockStateDocuments(versionData: McdocVersionData | undefined): McdocRagDocument[] {
  if (!versionData || !isRecord(versionData.blockStates)) return [];

  return Object.entries(versionData.blockStates).map(([blockId, value]): McdocRagDocument => {
    const states = Array.isArray(value) ? value : [];
    const hasExpectedShape = states.length >= 2 && isRecord(states[0]) && isRecord(states[1]);
    const allowed = hasExpectedShape ? states[0] : {};
    const defaults = hasExpectedShape ? states[1] : {};
    const propertyLines = Object.entries(allowed).map(([key, raw]) => {
      const values = Array.isArray(raw) ? raw.map(String).join(", ") : String(raw);
      const defaultValue = defaults[key];
      return `${key}: ${values}${defaultValue !== undefined ? ` (default ${String(defaultValue)})` : ""}`;
    });

    return {
      id: `block-state:${normalizeId(blockId)}`,
      title: `Minecraft block state ${blockId}`,
      text: compact([
        `Block: ${blockId}`,
        `Version: ${versionData.version}`,
        hasExpectedShape ? undefined : `Raw definition: ${summarizeJson(value)}`,
        propertyLines.length > 0 ? `Properties:\n${propertyLines.join("\n")}` : undefined,
      ]),
      metadata: {
        source: "block_states",
        kind: "block_state",
        jsonPath: `$.${blockId}`,
        version: versionData.version,
        blockId,
      },
    };
  });
}

function buildVersionDocuments(versions: readonly McdocVersion[] | undefined): McdocRagDocument[] {
  if (!versions) return [];

  return versions.map((version, index): McdocRagDocument => ({
    id: `version:${normalizeId(version.id)}`,
    title: `Minecraft version ${version.id}`,
    text: compact([
      `Version: ${version.id}`,
      `Name: ${version.name}`,
      `Type: ${version.type}`,
      `Stable: ${String(version.stable)}`,
      `Data version: ${String(version.dataVersion)}`,
      `Protocol version: ${String(version.protocolVersion)}`,
      `Data pack version: ${String(version.dataPackVersion)}.${String(version.dataPackVersionMinor)}`,
      `Resource pack version: ${String(version.resourcePackVersion)}.${String(version.resourcePackVersionMinor)}`,
      `Release time: ${version.releaseTime}`,
    ]),
    metadata: {
      source: "versions",
      kind: "version",
      jsonPath: `$[${index}]`,
      version: version.id,
    },
  }));
}
