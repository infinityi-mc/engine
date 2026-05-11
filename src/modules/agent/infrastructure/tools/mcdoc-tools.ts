import type { McdocRepositoryPort, SchemaProjection } from "../../../mcdoc/domain/ports/mcdoc-repository.port";
import { SchemaNotFoundError, UnsafeRegexError } from "../../../mcdoc/domain/errors/mcdoc.errors";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Tool, ToolResult } from "../../domain/types/tool.types";

const PROJECTION_VALUES: readonly SchemaProjection[] = ["summary", "full", "fields-only"] as const;

function toolError(message: string): ToolResult {
  return { output: message, isError: true };
}

function jsonOk(value: unknown): ToolResult {
  return { output: JSON.stringify(value), isError: false };
}

function asObject(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

export class McdocMetaTool implements Tool {
  readonly name = "mcdoc_meta";
  readonly description =
    "Returns the loaded Minecraft mcdoc schema metadata (ref commit, schema count, build timestamp).";
  readonly inputSchema: Record<string, unknown> = { type: "object", properties: {} };
  readonly groups = ["mcdoc"] as const;

  constructor(private readonly repo: McdocRepositoryPort, private readonly logger: LoggerPort) {}

  async execute(_input: unknown): Promise<ToolResult> {
    this.logger.info("mcdoc.tool.meta.executed");
    return jsonOk(this.repo.meta());
  }
}

export class McdocListPackagesTool implements Tool {
  readonly name = "mcdoc_list_packages";
  readonly description =
    "List the immediate sub-packages and schemas under a Minecraft mcdoc package path. Pass an empty prefix to list the root.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      prefix: {
        type: "string",
        description: "Fully-qualified package prefix, e.g. `::java::assets`. Omit or empty for the root.",
      },
    },
  };

  constructor(private readonly repo: McdocRepositoryPort, private readonly logger: LoggerPort) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input) ?? {};
    const prefix = typeof obj.prefix === "string" ? obj.prefix : undefined;
    const listing = this.repo.listPackages(prefix);
    this.logger.info("mcdoc.tool.list_packages.executed", {
      prefix: prefix ?? "",
      children: listing.children.length,
      schemas: listing.schemas.length,
    });
    return jsonOk(listing);
  }
}

export class McdocSearchTool implements Tool {
  readonly name = "mcdoc_search";
  readonly description =
    "Search Minecraft mcdoc schemas by name, field key, or description. Returns ranked hits with FQN, kind, score, and matchedOn reasons.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      kind: {
        type: "string",
        description: "Filter by schema kind (struct, enum, union, template).",
      },
      package: {
        type: "string",
        description: "Restrict to schemas whose path starts with this prefix.",
      },
      limit: {
        type: "number",
        description: "Maximum hits to return (default 20, max 100).",
      },
    },
    required: ["query"],
  };

  constructor(private readonly repo: McdocRepositoryPort, private readonly logger: LoggerPort) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const query = obj.query;
    if (typeof query !== "string" || query.length === 0) {
      return toolError("Missing or invalid required field: query (non-empty string).");
    }
    const kind = typeof obj.kind === "string" ? obj.kind : undefined;
    const pkg = typeof obj.package === "string" ? obj.package : undefined;
    const limit = typeof obj.limit === "number" ? obj.limit : undefined;

    const hits = this.repo.search(query, {
      ...(kind !== undefined ? { kind } : {}),
      ...(pkg !== undefined ? { package: pkg } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    this.logger.info("mcdoc.tool.search.executed", { query, resultCount: hits.length });
    return jsonOk({ hits });
  }
}

export class McdocGetTool implements Tool {
  readonly name = "mcdoc_get";
  readonly description =
    "Fetch a single Minecraft mcdoc schema by fully-qualified path. Default projection 'summary' returns kind + field summaries; 'full' returns the raw schema; 'fields-only' returns just the fields list.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Fully-qualified schema path, e.g. `::java::assets::atlas::Atlas`.",
      },
      projection: {
        type: "string",
        enum: PROJECTION_VALUES,
        description: "Output shape (default: summary).",
      },
    },
    required: ["path"],
  };

  constructor(private readonly repo: McdocRepositoryPort, private readonly logger: LoggerPort) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const schemaPath = obj.path;
    if (typeof schemaPath !== "string" || schemaPath.length === 0) {
      return toolError("Missing or invalid required field: path (non-empty string).");
    }

    let projection: SchemaProjection = "summary";
    if (obj.projection !== undefined) {
      if (typeof obj.projection !== "string" || !PROJECTION_VALUES.includes(obj.projection as SchemaProjection)) {
        return toolError(`projection must be one of: ${PROJECTION_VALUES.join(", ")}.`);
      }
      projection = obj.projection as SchemaProjection;
    }

    try {
      const result = this.repo.getSchema(schemaPath, projection);
      this.logger.info("mcdoc.tool.get.executed", { path: schemaPath, projection });
      return jsonOk(result);
    } catch (error) {
      if (error instanceof SchemaNotFoundError) {
        return toolError(error.message);
      }
      throw error;
    }
  }
}

export class McdocGrepFieldsTool implements Tool {
  readonly name = "mcdoc_grep_fields";
  readonly description =
    "Find Minecraft mcdoc schemas that contain a field whose key matches a regex. Useful for `where is field X defined?` queries.";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern (no nested quantifiers, no backreferences)." },
      limit: { type: "number", description: "Maximum matches (default 100, max 500)." },
    },
    required: ["pattern"],
  };

  constructor(private readonly repo: McdocRepositoryPort, private readonly logger: LoggerPort) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const pattern = obj.pattern;
    if (typeof pattern !== "string" || pattern.length === 0) {
      return toolError("Missing or invalid required field: pattern (non-empty string).");
    }
    const limit = typeof obj.limit === "number" ? obj.limit : undefined;

    try {
      const matches = this.repo.grepFields(pattern, limit);
      this.logger.info("mcdoc.tool.grep_fields.executed", { pattern, resultCount: matches.length });
      return jsonOk({ matches });
    } catch (error) {
      if (error instanceof UnsafeRegexError) {
        return toolError(error.message);
      }
      throw error;
    }
  }
}

export class McdocFindReferencesTool implements Tool {
  readonly name = "mcdoc_find_references";
  readonly description =
    "List Minecraft mcdoc schemas that reference the given schema path (reverse-reference lookup).";
  readonly groups = ["mcdoc"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      path: { type: "string", description: "Fully-qualified schema path." },
      limit: { type: "number", description: "Maximum references (default 100, max 500)." },
    },
    required: ["path"],
  };

  constructor(private readonly repo: McdocRepositoryPort, private readonly logger: LoggerPort) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const schemaPath = obj.path;
    if (typeof schemaPath !== "string" || schemaPath.length === 0) {
      return toolError("Missing or invalid required field: path (non-empty string).");
    }
    const limit = typeof obj.limit === "number" ? obj.limit : undefined;

    try {
      const references = this.repo.findReferences(schemaPath, limit);
      this.logger.info("mcdoc.tool.find_references.executed", {
        path: schemaPath,
        resultCount: references.length,
      });
      return jsonOk({ references });
    } catch (error) {
      if (error instanceof SchemaNotFoundError) {
        return toolError(error.message);
      }
      throw error;
    }
  }
}
