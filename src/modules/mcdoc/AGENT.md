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
| `resolveVersion()` | Return configured version or fetch API to find latest stable release |
| `fetchSymbols()` | Fetch mcdoc symbols from API, persist, return |
| `fetchVersionData()` | Fetch block_states, commands, registries for resolved version, persist, return |
| `getSymbols()` | Load symbols from local storage |
| `getVersionData()` | Load version data from local storage |

## Configuration

Single version only. Set in `config.yaml`:

```yaml
mcdoc:
  version: "26.1.2"   # optional, defaults to latest stable release
```

When `version` is omitted, `resolveVersion()` fetches `/mcje/versions` and picks the first entry where `stable === true && type === "release"`.

## API Endpoints

- `GET https://api.spyglassmc.com/mcje/versions` — version list (for resolution)
- `GET https://api.spyglassmc.com/vanilla-mcdoc/symbols` — mcdoc symbols
- `GET https://api.spyglassmc.com/mcje/versions/{version}/block_states` — block states
- `GET https://api.spyglassmc.com/mcje/versions/{version}/commands` — commands
- `GET https://api.spyglassmc.com/mcje/versions/{version}/registries` — registries

## Storage Layout

```
data/mcdoc/spyglassmc/
├── versions.json       # Cached version list (from resolution)
├── symbols.json        # Cached mcdoc symbols
├── block_states.json   # Block states for active version
├── commands.json       # Commands for active version
└── registries.json     # Registries for active version
```

## Runtime Rules

- Single-version design — one set of version data files at a time.
- Large API responses are streamed to a temp file, then parsed with try/finally cleanup.
- Storage uses atomic writes (temp file + rename).
- API responses validated with Zod at the infrastructure boundary.
- Domain types use camelCase; API responses use snake_case — transformation in API adapter.
- No HTTP routes exposed; consumed internally via `McdocService` on the container.

## Dependencies

consumes:
  `ConfigPort`   `../../shared/config/config.port.ts`
  `LoggerPort`   `../../shared/observability/logger.port.ts`

consumed-by:
  `agent` module (future RAG tool integration)
