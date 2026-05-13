# Mcdoc Module

## Purpose

Provides read-only search, browsing, projection, and reverse-reference lookup over the Minecraft mcdoc schema registry.

## Domain Model

types:
  `RawMcdocDocument`   `domain/types/mcdoc.types.ts`
  `RawSchemaEntry`     `domain/types/mcdoc.types.ts`
  `DerivedIndex`       `domain/types/mcdoc.types.ts`
  `McdocMeta`          `domain/types/mcdoc.types.ts`
  `PackageListing`     `domain/types/mcdoc.types.ts`
  `SchemaSummary`      `domain/types/mcdoc.types.ts`
  `SchemaFieldsOnly`   `domain/types/mcdoc.types.ts`
  `SearchHit`          `domain/types/mcdoc.types.ts`
  `GrepFieldMatch`     `domain/types/mcdoc.types.ts`

errors:
  `SchemaNotFoundError`   `domain/errors/mcdoc.errors.ts`
  `UnsafeRegexError`      `domain/errors/mcdoc.errors.ts`

## Ports

inbound:
  `McdocRepositoryPort`   `domain/ports/mcdoc-repository.port.ts`

outbound:
  `McdocLoaderPort`      `domain/ports/mcdoc-loader.port.ts`
  adapters:
    `FileMcdocLoader`    `infrastructure/persistence/file-mcdoc-loader.ts`

## Queries

| Query | Handler | Returns |
|-------|---------|---------|
| `mcdoc.meta` | `application/queries/mcdoc-meta.query.ts` | `McdocMeta` |
| `mcdoc.packages.list` | `application/queries/list-mcdoc-packages.query.ts` | `PackageListing` |
| `mcdoc.search` | `application/queries/search-mcdoc.query.ts` | `SearchHit[]` |
| `mcdoc.schema.get` | `application/queries/get-mcdoc-schema.query.ts` | schema projection |
| `mcdoc.fields.grep` | `application/queries/grep-mcdoc-fields.query.ts` | `GrepFieldMatch[]` |
| `mcdoc.references.find` | `application/queries/find-mcdoc-references.query.ts` | `string[]` |

## HTTP Routes

routes: `infrastructure/http/mcdoc-routes.ts`
scope: `mcdoc:read`

- `GET /mcdoc/meta`
- `GET /mcdoc/packages?prefix=...`
- `GET /mcdoc/search?q=...&kind=...&package=...&limit=...`
- `GET /mcdoc/schemas/:path?projection=summary|full|fields-only`; `:path` is URL-encoded FQN.
- `GET /mcdoc/fields?pattern=...&limit=...`
- `GET /mcdoc/schemas/:path/references?limit=...`; `:path` is URL-encoded FQN.

## Repository Rules

- `McdocRepository.create(loader, logger)` loads raw schema data and a derived index at startup.
- `FileMcdocLoader` reads `data/minecraft/symbol.json` by default via `src/bootstrap/container.ts`.
- Missing `symbol.json` returns an empty index and logs `mcdoc.symbol_file.missing`.
- Derived indexes are persisted at `data/minecraft/mcdoc-index/<ref>/index.json` and reused when `ref` and schema count match.
- `getSchema` projections are `summary`, `full`, and `fields-only`; default HTTP projection is `summary`.
- `full` returns the raw schema entry verbatim; do not mutate it.
- `grepFields` validates patterns with `shared/validation/regex-safety.ts`; default limit `100`, max `500`.
- `findReferences` requires the target path to exist; default limit `100`, max `500`.
- Search tokenizes path/name, field keys, and descriptions; default limit `20`, max `100`.

## Indexing

`application/indexer.ts` builds:

- package hierarchy and schemas by package prefix
- name/path token index
- field-key index
- description token index
- reverse reference index from nested reference types
- schema kind cache

## Dependencies

consumes:
  `LoggerPort`    `../../shared/observability/logger.port.ts`
  `QueryBus`      `../../shared/application/query-bus.ts`
  `JwtGuard`      `../../shared/http/jwt-guard.ts`

consumed-by:
  `agent` module mcdoc tools in `../agent/infrastructure/tools/mcdoc-tools.ts`

## Tests

`../../../test/mcdoc/mcdoc-repository.test.ts`
`../../../test/mcdoc/mcdoc-routes.test.ts`
`../../../test/mcdoc/search.test.ts`
`../../../test/mcdoc/projection.test.ts`
`../../../test/mcdoc/mcdoc-tools.test.ts`
