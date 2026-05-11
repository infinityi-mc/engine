import type { QueryBus } from "../../../../shared/application/query-bus";
import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import type { Router } from "../../../../shared/http/router";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import { FindMcdocReferencesQuery } from "../../application/queries/find-mcdoc-references.query";
import {
  GetMcdocSchemaQuery,
  type GetMcdocSchemaResult,
} from "../../application/queries/get-mcdoc-schema.query";
import { GrepMcdocFieldsQuery } from "../../application/queries/grep-mcdoc-fields.query";
import { ListMcdocPackagesQuery } from "../../application/queries/list-mcdoc-packages.query";
import { McdocMetaQuery } from "../../application/queries/mcdoc-meta.query";
import {
  SearchMcdocQuery,
  type SearchMcdocFilters,
} from "../../application/queries/search-mcdoc.query";
import {
  SchemaNotFoundError,
  UnsafeRegexError,
} from "../../domain/errors/mcdoc.errors";
import type {
  GrepFieldMatch,
  McdocMeta,
  PackageListing,
  SearchHit,
} from "../../domain/types/mcdoc.types";
import type { SchemaProjection } from "../../domain/ports/mcdoc-repository.port";
import { SCOPES } from "./scopes";

const PROJECTION_VALUES: readonly SchemaProjection[] = ["summary", "full", "fields-only"];

export function registerMcdocRoutes(
  router: Router,
  queryBus: QueryBus,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  // GET /mcdoc/meta
  router.get("/mcdoc/meta", guard.protect(async () => {
    return handleErrors(async () => {
      const meta = await queryBus.execute<McdocMetaQuery, McdocMeta>(new McdocMetaQuery());
      return jsonResponse(meta);
    }, logger);
  }, SCOPES.MCDOC_READ));

  // GET /mcdoc/packages?prefix=...
  router.get("/mcdoc/packages", guard.protect(async (request) => {
    return handleErrors(async () => {
      const url = new URL(request.url);
      const prefix = url.searchParams.get("prefix") ?? undefined;
      const listing = await queryBus.execute<ListMcdocPackagesQuery, PackageListing>(
        new ListMcdocPackagesQuery(prefix),
      );
      return jsonResponse(listing);
    }, logger);
  }, SCOPES.MCDOC_READ));

  // GET /mcdoc/search?q=...&kind=...&package=...&limit=...
  router.get("/mcdoc/search", guard.protect(async (request) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    if (!q) {
      return jsonResponse({ error: "InvalidInput", field: "q", message: "q is required" }, { status: 400 });
    }

    const limitParam = url.searchParams.get("limit");
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return jsonResponse({ error: "InvalidInput", field: "limit" }, { status: 400 });
      }
      limit = parsed;
    }

    return handleErrors(async () => {
      const filters: SearchMcdocFilters = {
        ...(url.searchParams.get("kind") ? { kind: url.searchParams.get("kind")! } : {}),
        ...(url.searchParams.get("package") ? { package: url.searchParams.get("package")! } : {}),
        ...(limit !== undefined ? { limit } : {}),
      };
      const hits = await queryBus.execute<SearchMcdocQuery, readonly SearchHit[]>(
        new SearchMcdocQuery(q, filters),
      );
      return jsonResponse({ hits });
    }, logger);
  }, SCOPES.MCDOC_READ));

  // GET /mcdoc/schemas/:path  (path is URL-encoded FQN)
  router.get("/mcdoc/schemas/:path", guard.protect(async (request, params) => {
    const url = new URL(request.url);
    const projectionParam = url.searchParams.get("projection") ?? "summary";
    if (!PROJECTION_VALUES.includes(projectionParam as SchemaProjection)) {
      return jsonResponse(
        { error: "InvalidInput", field: "projection", allowed: PROJECTION_VALUES },
        { status: 400 },
      );
    }

    return handleErrors(async () => {
      const schemaPath = decodeURIComponent(params.path!);
      const result = await queryBus.execute<GetMcdocSchemaQuery, GetMcdocSchemaResult>(
        new GetMcdocSchemaQuery(schemaPath, projectionParam as SchemaProjection),
      );
      return jsonResponse(result);
    }, logger);
  }, SCOPES.MCDOC_READ));

  // GET /mcdoc/fields?pattern=...&limit=...
  router.get("/mcdoc/fields", guard.protect(async (request) => {
    const url = new URL(request.url);
    const pattern = url.searchParams.get("pattern");
    if (!pattern) {
      return jsonResponse({ error: "InvalidInput", field: "pattern", message: "pattern is required" }, { status: 400 });
    }

    const limitParam = url.searchParams.get("limit");
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return jsonResponse({ error: "InvalidInput", field: "limit" }, { status: 400 });
      }
      limit = parsed;
    }

    return handleErrors(async () => {
      const matches = await queryBus.execute<GrepMcdocFieldsQuery, readonly GrepFieldMatch[]>(
        new GrepMcdocFieldsQuery(pattern, limit),
      );
      return jsonResponse({ matches });
    }, logger);
  }, SCOPES.MCDOC_READ));

  // GET /mcdoc/schemas/:path/references
  router.get("/mcdoc/schemas/:path/references", guard.protect(async (request, params) => {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    let limit: number | undefined;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return jsonResponse({ error: "InvalidInput", field: "limit" }, { status: 400 });
      }
      limit = parsed;
    }

    return handleErrors(async () => {
      const schemaPath = decodeURIComponent(params.path!);
      const references = await queryBus.execute<FindMcdocReferencesQuery, readonly string[]>(
        new FindMcdocReferencesQuery(schemaPath, limit),
      );
      return jsonResponse({ references });
    }, logger);
  }, SCOPES.MCDOC_READ));
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SchemaNotFoundError) {
      return jsonResponse(
        { error: "SchemaNotFound", path: error.path, message: error.message },
        { status: 404 },
      );
    }
    if (error instanceof UnsafeRegexError) {
      return jsonResponse({ error: "UnsafeRegex", message: error.message }, { status: 400 });
    }

    logger.error("mcdoc.http.unexpected_error", {
      module: "mcdoc",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return jsonResponse({ error: "Internal Server Error" }, { status: 500 });
  }
}
