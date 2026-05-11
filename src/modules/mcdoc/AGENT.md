# Mcdoc Module Notes

This module loads the Minecraft `symbol.json` schema registry, builds a persisted derived index, and serves read-only queries over the 1,821 schemas — for both HTTP clients and agent tools.

## Layout

- `domain/` — `McdocRepositoryPort`, `McdocLoaderPort`, `mcdoc.types.ts`, errors (`SchemaNotFoundError`, `UnsafeRegexError`).
- `application/` — pure `indexer.ts`, `search.ts`, `projection.ts`; `McdocRepository` orchestrates them with the loader; CQRS query/handler pairs under `queries/`.
- `infrastructure/persistence/file-mcdoc-loader.ts` — reads `data/minecraft/symbol.json`, loads or builds the sidecar derived index at `data/minecraft/mcdoc-index/<ref>/index.json`.
- `infrastructure/http/` — `scopes.ts` (`mcdoc:read`) + `mcdoc-routes.ts`.

## Index lifecycle

`createContainer()` is async because the index must be ready before any request. On startup:

1. Read `data/minecraft/symbol.json` and validate shape.
2. If `data/minecraft/mcdoc-index/<ref>/index.json` exists and matches `ref` + `schemaCount`, load it from disk.
3. Otherwise, build the index in-memory and persist it (best-effort — persistence failure is logged but does not block startup).

The persisted index is purely derived from `symbol.json`; deleting `mcdoc-index/` simply triggers a rebuild on next boot.

## Tools

Six agent tools registered in `container.ts`:

| Tool | Purpose |
|------|---------|
| `mcdoc_meta` | Returns `{ ref, schemaCount, builtAt }`. |
| `mcdoc_list_packages` | Lists immediate sub-packages + leaf schemas under a prefix. |
| `mcdoc_search` | Ranked search across path + field keys + descriptions. |
| `mcdoc_get` | Fetch a schema (`summary` / `full` / `fields-only` projection). |
| `mcdoc_grep_fields` | Find schemas with field keys matching a regex. |
| `mcdoc_find_references` | Reverse-reference lookup. |

## HTTP

All routes are `GET` under scope `mcdoc:read`:

| Path | Description |
|------|-------------|
| `/mcdoc/meta` | Index metadata. |
| `/mcdoc/packages?prefix=...` | Package listing. |
| `/mcdoc/search?q=...&kind=...&package=...&limit=...` | Ranked search. |
| `/mcdoc/schemas/:path?projection=...` | Fetch one schema (`:path` is URL-encoded FQN). |
| `/mcdoc/fields?pattern=...&limit=...` | Regex-based field key search. |
| `/mcdoc/schemas/:path/references?limit=...` | Reverse references. |

Errors map: `SchemaNotFoundError` → 404, `UnsafeRegexError` → 400.

## Limits

- Search `limit` ≤ 100 (default 20).
- `grepFields.limit` ≤ 500 (default 100).
- `findReferences.limit` ≤ 500 (default 100).
- Regex pattern length ≤ 256 chars; nested quantifiers and backreferences rejected (same ReDoS guard as system `grep`).

## Versioning

Single active version. The `ref` from `symbol.json` is exposed via `mcdoc_meta` and the `/mcdoc/meta` endpoint. To upgrade, replace `symbol.json`; the index rebuilds automatically on next startup.
