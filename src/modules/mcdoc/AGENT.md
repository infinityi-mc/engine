# Mcdoc Module

## Purpose

Fetches and caches Minecraft technical knowledge from the SpyglassMC API. Provides domain-typed access to version metadata, mcdoc symbols, and version-specific data (block states, commands, registries). Foundation for future RAG (Retrieval-Augmented Generation) phases.

## Domain Model

types:
  `McdocVersion`    `domain/types/mcdoc.ts`
  `McdocSymbols`    `domain/types/mcdoc.ts`
  `McdocSymbolEntry` `domain/types/mcdoc.ts`
  `McdocVersionData` `domain/types/mcdoc.ts`

## Ports

outbound:
  `McdocApiPort`     `domain/ports/mcdoc-api.port.ts`
  adapters:
    `SpyglassMcApiAdapter`   `infrastructure/api/spyglassmc-api.adapter.ts`
  `McdocStoragePort` `domain/ports/mcdoc-storage.port.ts`
  adapters:
    `JsonMcdocStorageAdapter`   `infrastructure/storage/json-mcdoc-storage.adapter.ts`

## Service

`McdocService`   `application/mcdoc.service.ts`

| Method | Effect |
|--------|--------|
| `fetchVersions()` | Fetch version list from API, persist, return |
| `fetchSymbols()` | Fetch mcdoc symbols from API, persist, return |
| `fetchVersionData(version)` | Fetch block_states, commands, registries for a version, persist, return |
| `getVersions()` | Load versions from local storage |
| `getSymbols()` | Load symbols from local storage |
| `getVersionData(version)` | Load version data from local storage |
| `listCachedVersions()` | List version directories on disk |

## API Endpoints

- `GET https://api.spyglassmc.com/mcje/versions` — version list
- `GET https://api.spyglassmc.com/vanilla-mcdoc/symbols` — mcdoc symbols
- `GET https://api.spyglassmc.com/mcje/versions/{version}/block_states` — block states
- `GET https://api.spyglassmc.com/mcje/versions/{version}/commands` — commands
- `GET https://api.spyglassmc.com/mcje/versions/{version}/registries` — registries

## Storage Layout

```
data/mcdoc/spyglassmc/
├── versions.json              # Cached version list
├── symbols.json               # Cached mcdoc symbols
├── {version}/                 # Per-version directory
│   ├── block_states.json
│   ├── commands.json
│   └── registries.json
```

## Runtime Rules

- Large API responses (symbols, block_states, commands, registries) are streamed to a temp file, then parsed.
- Storage uses atomic writes (temp file + rename).
- API responses are validated with Zod at the infrastructure boundary.
- Domain types use camelCase; API responses use snake_case — transformation happens in the API adapter.
- No HTTP routes exposed; consumed internally via `McdocService` on the container.

## Dependencies

consumes:
  `LoggerPort`   `../../shared/observability/logger.port.ts`

consumed-by:
  `agent` module (future RAG tool integration)

## Tests

(To be added)
