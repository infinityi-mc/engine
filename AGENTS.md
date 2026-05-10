# AGENTS.md

This file provides guidance when working with code in this repository.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start server with watch mode (default port 3000, override with PORT)
bun run start        # Start server without watch
bun test             # Run all tests
bun run typecheck    # Run TypeScript strict checks (bunx tsc --noEmit)
```

Run a single test file:

```bash
bun test test/system/system-module.test.ts
```

Run a test by name pattern:

```bash
bun test -t "copies, moves, and deletes"
```

## Architecture

Bun + TypeScript HTTP API using Hexagonal Architecture, CQRS, and Event-Driven Architecture. No framework — uses `Bun.serve` directly with a custom `Router` class.

### Layer boundaries

```
HTTP route (infrastructure)
  → CommandBus or QueryBus (shared application)
    → Handler (module application)
      → Port interface (module domain)
        → Adapter (module infrastructure)
```

- **Domain** — Ports (interfaces), domain errors, entities, events. No imports from application or infrastructure. No framework imports (`Bun`, `jose`, `node:*`).
- **Application** — Commands, queries, handlers. Depends on domain ports, never on concrete adapters or HTTP types.
- **Infrastructure** — HTTP routes, adapters (filesystem, terminal, process, registry). Can depend on application and domain.
- **Bootstrap** — `container.ts` wires everything together: instantiates buses, adapters, registers handlers.

### CQRS rules

- Commands mutate state. Queries return data. Commands may return data when the caller needs immediate feedback (e.g., process metadata from execution, PID from spawn). This project uses CQRS for intent separation, not strict return-type enforcement.
- Queries should be read-only, but may perform staleness correction (e.g., updating a "running" status to "crashed" when the process is dead) as an intentional side effect.
- Command/query types are string-const discriminants (e.g. `"system.files.copy"`).
- Each command has a `.command.ts` + `.handler.ts` pair; each query has a `.query.ts` + `.handler.ts` pair.

### Adding a new module

1. Create `src/modules/<name>/domain` — ports (interfaces) and errors.
2. Create `src/modules/<name>/application` — commands, queries, handlers.
3. Create `src/modules/<name>/infrastructure` — HTTP routes and adapters.
4. Register handlers and adapters in `src/bootstrap/container.ts`.
5. Register routes in `src/main.ts`.

### Auth

All system and server routes are JWT-protected via `JwtGuard.protect(handler, scope)`. Tokens carry a `scope` claim with space-separated scope strings. Scopes are defined per module (e.g., `src/modules/system/infrastructure/http/scopes.ts`, `src/modules/server/infrastructure/http/scopes.ts`). If `JWT_SECRET` is not set, the guard uses an empty secret which causes all token verification to fail — effectively blocking all authenticated routes, not disabling auth.

### Observability

`LoggerPort` interface with `ConsoleLoggerAdapter` producing human-readable, terminal-colored logs to stdout/stderr. Logs intentionally exclude sensitive data (file contents, terminal stdout/stderr, env vars, full args, sed/awk scripts). Set `LOG_LEVEL` env var to `debug`/`info`/`warn`/`error`.

### Key conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- JSON request bodies capped at 1 MiB, parsed with streaming limit.
- Grep rejects unsafe regex patterns (nested quantifiers, backreferences) and caps at 10K files / 64 depth.
- Glob defaults to 10K max results; `maxResults` overrides per call.
- `awk` and `sed` delegate to host OS binaries; `UnsupportedToolError` (HTTP 501) when unavailable.
- Terminal `env` is merged on top of host environment so `PATH` resolution still works.
- `shell: false` preferred for terminal execution (structured args); `shell: true` wraps via `cmd.exe /d /s /c` (Windows) or `/bin/sh -lc` (Unix).
- Route handlers use `Result`-style returns (`{ ok: true, value }` / `{ ok: false, response }`) rather than throwing for input validation errors.

### EventBus and AggregateRoot

`EventBus` (`src/shared/application/event-bus.ts`) is wired into the system. `MinecraftLogListener` publishes `MinecraftLogPatternMatched` events through it. `AggregateRoot` (`src/shared/domain/aggregate-root.ts`) is present but unused — reserved for future event-driven features.

### Persistence
- Persistent data (files, databases) must be stored inside `data/`.
- Application configuration stored in `config.yaml`.
