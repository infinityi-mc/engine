import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { NbtPort } from "../../../minecraft/domain/ports/nbt.port";
import { NbtFileNotFoundError } from "../../../minecraft/domain/errors/nbt-file-not-found.error";
import { NbtPathNotFoundError } from "../../../minecraft/domain/errors/nbt-path-not-found.error";
import { RegexSafetyError } from "../../../../shared/validation/regex-safety";
import type { Tool, ToolResult } from "../../domain/types/tool.types";
import { toolError, jsonOk, asObject } from "./tool-helpers";

const MAX_READ_DEPTH = 10;
const MAX_STRUCTURE_DEPTH = 5;
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;

function handleNbtError(error: unknown): ToolResult {
  if (error instanceof NbtFileNotFoundError) {
    return toolError(error.message);
  }
  if (error instanceof NbtPathNotFoundError) {
    return toolError(error.message);
  }
  if (error instanceof RegexSafetyError) {
    return toolError(error.message);
  }
  if (error instanceof Error) {
    return toolError(error.message);
  }
  throw error;
}

export class NbtReadTool implements Tool {
  readonly name = "nbt_read";
  readonly description =
    "Read and parse an NBT .dat file (e.g. level.dat, playerdata). Returns the NBT tree truncated to the given depth. Never returns the full tree — always specify a depth (max 10).";
  readonly groups = ["nbt"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the .dat file.",
      },
      depth: {
        type: "number",
        description:
          "Maximum tree depth to expand (1-10). Deeper nodes are shown as type hints like {compound, 5 keys: [...]}.",
      },
    },
    required: ["filePath", "depth"],
  };

  constructor(
    private readonly nbt: NbtPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const filePath = obj.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return toolError(
        "Missing or invalid required field: filePath (non-empty string).",
      );
    }

    const depth = obj.depth;
    if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1) {
      return toolError("depth must be a positive integer (1-10).");
    }
    if (depth > MAX_READ_DEPTH) {
      return toolError(`depth must be at most ${MAX_READ_DEPTH}.`);
    }

    try {
      const result = await this.nbt.read(filePath, depth);
      this.logger.info("nbt.tool.read.executed", { filePath, depth });
      return jsonOk(result);
    } catch (error) {
      return handleNbtError(error);
    }
  }
}

export class NbtGetTool implements Tool {
  readonly name = "nbt_get";
  readonly description =
    "Navigate to a specific path in an NBT .dat file and return the value at that path. Use dot notation for compounds (e.g. 'Data.Player.Pos') and array indices for lists (e.g. 'Data.Player.Inventory.0').";
  readonly groups = ["nbt"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the .dat file.",
      },
      path: {
        type: "string",
        description:
          "Dot-separated path to the NBT node (e.g. 'Data.Player', 'Data.WorldGenSettings.seed').",
      },
    },
    required: ["filePath", "path"],
  };

  constructor(
    private readonly nbt: NbtPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const filePath = obj.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return toolError(
        "Missing or invalid required field: filePath (non-empty string).",
      );
    }

    const path = obj.path;
    if (typeof path !== "string" || path.length === 0) {
      return toolError(
        "Missing or invalid required field: path (non-empty string).",
      );
    }

    try {
      const result = await this.nbt.get(filePath, path);
      this.logger.info("nbt.tool.get.executed", { filePath, path });
      return jsonOk(result);
    } catch (error) {
      return handleNbtError(error);
    }
  }
}

export class NbtSearchTool implements Tool {
  readonly name = "nbt_search";
  readonly description =
    "Search for all key names in an NBT .dat file that match a pattern. Returns dot-separated paths to matching keys. Useful for finding where data lives in unknown NBT files.";
  readonly groups = ["nbt"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the .dat file.",
      },
      pattern: {
        type: "string",
        description:
          "Regex pattern to match key names (case-insensitive). Example: 'Pos', 'Inventory', 'player.*health'.",
      },
      limit: {
        type: "number",
        description: `Maximum matches to return (default: ${DEFAULT_SEARCH_LIMIT}, max: ${MAX_SEARCH_LIMIT}).`,
      },
    },
    required: ["filePath", "pattern"],
  };

  constructor(
    private readonly nbt: NbtPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const filePath = obj.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return toolError(
        "Missing or invalid required field: filePath (non-empty string).",
      );
    }

    const pattern = obj.pattern;
    if (typeof pattern !== "string" || pattern.length === 0) {
      return toolError(
        "Missing or invalid required field: pattern (non-empty string).",
      );
    }

    let limit = DEFAULT_SEARCH_LIMIT;
    if (obj.limit !== undefined) {
      if (
        typeof obj.limit !== "number" ||
        !Number.isInteger(obj.limit) ||
        obj.limit < 1
      ) {
        return toolError("limit must be a positive integer.");
      }
      if (obj.limit > MAX_SEARCH_LIMIT) {
        return toolError(`limit must be at most ${MAX_SEARCH_LIMIT}.`);
      }
      limit = obj.limit;
    }

    try {
      const matches = await this.nbt.search(filePath, pattern, limit);
      this.logger.info("nbt.tool.search.executed", {
        filePath,
        pattern,
        resultCount: matches.length,
      });
      return jsonOk({ matches });
    } catch (error) {
      return handleNbtError(error);
    }
  }
}

export class NbtKeysTool implements Tool {
  readonly name = "nbt_keys";
  readonly description =
    "List the immediate child keys (with their NBT types) at a given path in an NBT .dat file. Use to explore the structure of an NBT tree interactively.";
  readonly groups = ["nbt"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the .dat file.",
      },
      path: {
        type: "string",
        description:
          "Dot-separated path to the parent node. Omit or empty for root.",
      },
    },
    required: ["filePath"],
  };

  constructor(
    private readonly nbt: NbtPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const filePath = obj.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return toolError(
        "Missing or invalid required field: filePath (non-empty string).",
      );
    }

    const path =
      typeof obj.path === "string" && obj.path.length > 0
        ? obj.path
        : undefined;

    try {
      const keys = await this.nbt.keys(filePath, path);
      this.logger.info("nbt.tool.keys.executed", {
        filePath,
        path: path ?? "",
        keyCount: keys.length,
      });
      return jsonOk({ keys });
    } catch (error) {
      return handleNbtError(error);
    }
  }
}

export class NbtStructureTool implements Tool {
  readonly name = "nbt_structure";
  readonly description =
    "Return a schema-like overview of an NBT .dat file showing key names and tag types up to a given depth. Useful for understanding the shape of unknown NBT data.";
  readonly groups = ["nbt"] as const;
  readonly inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Absolute path to the .dat file.",
      },
      depth: {
        type: "number",
        description: `Maximum depth to traverse (1-${MAX_STRUCTURE_DEPTH}). Lists show up to 5 items.`,
      },
    },
    required: ["filePath", "depth"],
  };

  constructor(
    private readonly nbt: NbtPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: unknown): Promise<ToolResult> {
    const obj = asObject(input);
    if (!obj) return toolError("Input must be an object.");

    const filePath = obj.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return toolError(
        "Missing or invalid required field: filePath (non-empty string).",
      );
    }

    const depth = obj.depth;
    if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1) {
      return toolError("depth must be a positive integer (1-5).");
    }
    if (depth > MAX_STRUCTURE_DEPTH) {
      return toolError(`depth must be at most ${MAX_STRUCTURE_DEPTH}.`);
    }

    try {
      const entries = await this.nbt.structure(filePath, depth);
      this.logger.info("nbt.tool.structure.executed", {
        filePath,
        depth,
        entryCount: entries.length,
      });
      return jsonOk({ entries });
    } catch (error) {
      return handleNbtError(error);
    }
  }
}
