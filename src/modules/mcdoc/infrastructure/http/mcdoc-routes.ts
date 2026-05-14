import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import { parseJson } from "../../../../shared/http/route-helpers";
import type { Router } from "../../../../shared/http/router";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { McdocService } from "../../../mcdoc/application/mcdoc.service";
import type { McdocRagFilters, McdocRagKind, McdocRagSource } from "../../../mcdoc/domain/types/mcdoc-rag";
import { SCOPES } from "./scopes";

const VALID_SOURCES: readonly McdocRagSource[] = ["symbols", "commands", "registries", "block_states", "versions"];
const VALID_KINDS: readonly McdocRagKind[] = ["symbol", "symbol_field", "command", "registry", "registry_entry", "block_state", "version"];

export function registerMcdocRoutes(
  router: Router,
  service: McdocService,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  // POST /mcdoc/search — Search mcdoc RAG index
  router.post("/mcdoc/search", guard.protect(async (request) => {
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const { query, filters, limit } = parsed.body;
    if (typeof query !== "string" || query.trim().length === 0) {
      return jsonResponse({ error: "InvalidInput", field: "query", message: "query must be a non-empty string" }, { status: 400 });
    }

    const parsedFilters = parseFilters(filters);
    if (parsedFilters.error) return parsedFilters.response;

    const parsedLimit = parsePositiveInteger(limit);

    return handleErrors(async () => {
      const results = await service.searchRag(query.trim(), parsedFilters.value, parsedLimit);
      return jsonResponse({ results });
    }, logger);
  }, SCOPES.MCDOC_READ));

  // POST /mcdoc/retrieve — Retrieve a single mcdoc RAG document by ID
  router.post("/mcdoc/retrieve", guard.protect(async (request) => {
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const { id } = parsed.body;
    if (typeof id !== "string" || id.trim().length === 0) {
      return jsonResponse({ error: "InvalidInput", field: "id", message: "id must be a non-empty string" }, { status: 400 });
    }

    return handleErrors(async () => {
      const document = await service.retrieveRagDocument(id.trim());
      if (!document) {
        return jsonResponse({ error: "NotFound", message: `No mcdoc RAG document found for ID: ${id}` }, { status: 404 });
      }
      return jsonResponse({ document });
    }, logger);
  }, SCOPES.MCDOC_READ));

  // POST /mcdoc/answer — Answer a question using mcdoc RAG context
  router.post("/mcdoc/answer", guard.protect(async (request) => {
    const parsed = await parseJson(request);
    if (!parsed.ok) return parsed.response;

    const { question, filters } = parsed.body;
    if (typeof question !== "string" || question.trim().length === 0) {
      return jsonResponse({ error: "InvalidInput", field: "question", message: "question must be a non-empty string" }, { status: 400 });
    }

    const parsedFilters = parseFilters(filters);
    if (parsedFilters.error) return parsedFilters.response;

    return handleErrors(async () => {
      const answer = await service.answerRag(question.trim(), parsedFilters.value);
      return jsonResponse(answer);
    }, logger);
  }, SCOPES.MCDOC_READ));

  // POST /mcdoc/rebuild — Force rebuild the RAG index (embeds all documents)
  router.post("/mcdoc/rebuild", guard.protect(async () => {
    return handleErrors(async () => {
      const index = await service.rebuildRagIndex();
      return jsonResponse({
        ok: true,
        documentCount: index.manifest.documentCount,
        vectorCount: index.manifest.vectorCount,
        embeddingModel: index.manifest.embeddingModel,
        sourceVersion: index.manifest.sourceVersion,
        symbolRef: index.manifest.symbolRef,
      });
    }, logger);
  }, SCOPES.MCDOC_WRITE));
}

function parseFilters(value: unknown): { error: true; response: Response } | { error: false; value: McdocRagFilters | undefined } {
  if (value === undefined || value === null) return { error: false, value: undefined };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: true, response: jsonResponse({ error: "InvalidInput", field: "filters", message: "filters must be an object" }, { status: 400 }) };
  }

  const obj = value as Record<string, unknown>;
  const filters: Record<string, unknown> = {};

  if (obj.source !== undefined) {
    if (typeof obj.source !== "string" || !VALID_SOURCES.includes(obj.source as McdocRagSource)) {
      return { error: true, response: jsonResponse({ error: "InvalidInput", field: "filters.source", message: `source must be one of: ${VALID_SOURCES.join(", ")}` }, { status: 400 }) };
    }
    filters.source = obj.source;
  }

  if (obj.kind !== undefined) {
    if (typeof obj.kind !== "string" || !VALID_KINDS.includes(obj.kind as McdocRagKind)) {
      return { error: true, response: jsonResponse({ error: "InvalidInput", field: "filters.kind", message: `kind must be one of: ${VALID_KINDS.join(", ")}` }, { status: 400 }) };
    }
    filters.kind = obj.kind;
  }

  for (const key of ["version", "symbolPath", "registry", "blockId"] as const) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== "string" || (obj[key] as string).trim().length === 0) {
        return { error: true, response: jsonResponse({ error: "InvalidInput", field: `filters.${key}`, message: `${key} must be a non-empty string` }, { status: 400 }) };
      }
      filters[key] = (obj[key] as string).trim();
    }
  }

  return { error: false, value: filters as McdocRagFilters };
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    logger.error("mcdoc.http.unhandled_error", {
      module: "mcdoc",
      operation: "http.handle",
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "InternalServerError" }, { status: 500 });
  }
}
