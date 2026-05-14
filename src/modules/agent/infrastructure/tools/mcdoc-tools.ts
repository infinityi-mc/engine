import type { McdocService } from "../../../mcdoc/application/mcdoc.service";
import type { McdocRagFilters } from "../../../mcdoc/domain/types/mcdoc-rag";
import type { Tool, ToolContext, ToolResult } from "../../domain/types/tool.types";
import { asObject, jsonOk, toolError } from "./tool-helpers";

type MutableFilters = { -readonly [Key in keyof McdocRagFilters]: McdocRagFilters[Key] };
type McdocFilterSource = NonNullable<McdocRagFilters["source"]>;
type McdocFilterKind = NonNullable<McdocRagFilters["kind"]>;

const MCDOC_FILTER_SOURCES = ["symbols", "commands", "registries", "block_states", "versions"] as const satisfies readonly McdocFilterSource[];
const MCDOC_FILTER_KINDS = ["symbol", "symbol_field", "command", "registry", "registry_entry", "block_state", "version"] as const satisfies readonly McdocFilterKind[];

const MCDOC_FILTER_SCHEMA = {
  type: "object",
  description: "Optional mcdoc RAG filters.",
  properties: {
    source: { type: "string", enum: [...MCDOC_FILTER_SOURCES] },
    kind: { type: "string", enum: [...MCDOC_FILTER_KINDS] },
    version: { type: "string" },
    symbolPath: { type: "string" },
    registry: { type: "string" },
    blockId: { type: "string" },
  },
} as const;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isMcdocFilterSource(value: string): value is McdocFilterSource {
  return (MCDOC_FILTER_SOURCES as readonly string[]).includes(value);
}

function isMcdocFilterKind(value: string): value is McdocFilterKind {
  return (MCDOC_FILTER_KINDS as readonly string[]).includes(value);
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function readFilters(value: unknown): McdocRagFilters | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;

  const filters: MutableFilters = {};
  const source = readString(obj.source);
  const kind = readString(obj.kind);
  const version = readString(obj.version);
  const symbolPath = readString(obj.symbolPath);
  const registry = readString(obj.registry);
  const blockId = readString(obj.blockId);

  if (source) {
    if (!isMcdocFilterSource(source)) {
      throw new Error(`Invalid filters.source: ${source}`);
    }
    filters.source = source;
  }
  if (kind) {
    if (!isMcdocFilterKind(kind)) {
      throw new Error(`Invalid filters.kind: ${kind}`);
    }
    filters.kind = kind;
  }
  if (version) filters.version = version;
  if (symbolPath) filters.symbolPath = symbolPath;
  if (registry) filters.registry = registry;
  if (blockId) filters.blockId = blockId;
  return filters;
}

export class McdocSearchTool implements Tool {
  readonly name = "mcdoc_search";
  readonly description = "Search cached SpyglassMC mcdoc technical knowledge for Minecraft commands, registries, block states, versions, and mcdoc symbols.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query, identifier, command path, block ID, registry entry, or natural-language question." },
      limit: { type: "number", description: "Maximum number of ranked results to return." },
      filters: MCDOC_FILTER_SCHEMA,
    },
    required: ["query"],
  };

  constructor(private readonly mcdocService: McdocService) {}

  async execute(input: unknown, _context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const query = readString(obj.query);
    if (!query) return toolError("Missing or invalid required field: query (non-empty string).");

    try {
      const results = await this.mcdocService.searchRag(query, readFilters(obj.filters), readPositiveInteger(obj.limit));
      return jsonOk({ results });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }
}

export class McdocRetrieveTool implements Tool {
  readonly name = "mcdoc_retrieve";
  readonly description = "Retrieve one exact mcdoc RAG document by ID returned from mcdoc_search.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      id: { type: "string", description: "Document ID returned from mcdoc_search." },
    },
    required: ["id"],
  };

  constructor(private readonly mcdocService: McdocService) {}

  async execute(input: unknown, _context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const id = readString(obj.id);
    if (!id) return toolError("Missing or invalid required field: id (non-empty string).");

    try {
      const document = await this.mcdocService.retrieveRagDocument(id);
      if (!document) return toolError(`No mcdoc RAG document found for ID: ${id}`);
      return jsonOk({ document });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }
}

export class McdocAnswerTool implements Tool {
  readonly name = "mcdoc_answer";
  readonly description = "Answer a Minecraft technical question using cached SpyglassMC mcdoc RAG context with citations.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      question: { type: "string", description: "Minecraft technical question to answer from mcdoc context." },
      filters: MCDOC_FILTER_SCHEMA,
    },
    required: ["question"],
  };

  constructor(private readonly mcdocService: McdocService) {}

  async execute(input: unknown, _context?: ToolContext): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const question = readString(obj.question);
    if (!question) return toolError("Missing or invalid required field: question (non-empty string).");

    try {
      const answer = await this.mcdocService.answerRag(question, readFilters(obj.filters));
      return jsonOk(answer);
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }
}
