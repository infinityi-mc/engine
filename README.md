# Bun Event-Driven Hexagonal CQRS Template

A small Bun + TypeScript HTTP API template using native `Bun.serve`, Event-Driven Architecture, Hexagonal Architecture, and CQRS.

## Quick Start

```bash
bun install
bun run dev
```

The server starts on `http://localhost:3000` by default. Override it with `PORT`.

```bash
PORT=4000 bun run dev
```

## Scripts

```bash
bun run dev        # Start with watch mode
bun run start      # Start normally
bun test           # Run tests
bun run typecheck  # Run TypeScript checks
```

## Endpoints

```http
GET /health
```

System discovery endpoints:

```http
POST /system/files/glob
POST /system/files/grep
POST /system/files/list
POST /system/files/read
POST /system/files/awk
```

System management endpoints:

```http
POST /system/files/move
POST /system/files/copy
POST /system/files/delete
POST /system/files/sed
```

Terminal endpoint:

```http
POST /system/terminal/execute
```

The system module does not enforce sandboxing, path allowlists, command allowlists, or other constraints. Callers are responsible for applying those policies before using the module.

`glob`, `grep`, `list`, `read`, `move`, `copy`, `delete`, and terminal execution are implemented with Bun/Node APIs and support Windows and Linux. `awk` and `sed` call the real installed tools. If the current environment does not provide those binaries, the API returns:

```json
{
  "error": "UnsupportedTool",
  "tool": "awk",
  "message": "awk is not available in this environment"
}
```

`glob` defaults to a maximum of 10,000 results. Pass `maxResults` to lower or raise that limit for a specific call.

`grep` treats `pattern` as a regular expression, returns every match per line, and rejects known unsafe regex features such as nested quantifiers and backreferences.

Recursive grep discovery is capped at 10,000 files and 64 directory levels by default.

System route JSON bodies are limited to 1 MiB.

For terminal execution, prefer `shell: false` with structured `args`. If `env` is provided, it is merged on top of the host environment so command resolution still has access to variables such as `PATH`.

## Observability

The project uses a `LoggerPort` with a native console adapter by default. Logs are structured JSON written to stdout/stderr and are not persisted to disk by the app.

Set the minimum log level with `LOG_LEVEL`:

```bash
LOG_LEVEL=debug bun run dev
```

For the system module, logs intentionally include safe metadata such as operation name, duration, counts, exit code, and error type. They intentionally exclude file contents, terminal stdin/stdout/stderr, environment variables, full sed scripts, full awk programs, and full args arrays.

Example terminal request:

```http
POST /system/terminal/execute
Content-Type: application/json

{
  "command": "bun",
  "args": ["--version"],
  "timeoutMs": 10000
}
```

## Architecture

```txt
src
├── bootstrap
│   └── container.ts
├── shared
│   ├── application
│   │   ├── command-bus.ts
│   │   ├── event-bus.ts
│   │   └── query-bus.ts
│   ├── domain
│   │   ├── aggregate-root.ts
│   │   └── domain-event.ts
│   └── http
│       ├── json-response.ts
│       └── router.ts
└── modules
    └── system
        ├── domain
        ├── application
        └── infrastructure
```

## Request Flow

```txt
HTTP route
-> CommandBus or QueryBus
-> Application handler
-> Domain port
-> Infrastructure adapter
```

## Boundaries

Domain layer:
- Owns business rules and domain events.
- Does not import application or infrastructure code.

Application layer:
- Owns commands, queries, handlers, and orchestration.
- Depends on domain ports, not concrete adapters.

Infrastructure layer:
- Owns HTTP routes, persistence adapters, and external integrations.
- Can depend on application and domain layers.

Bootstrap layer:
- Wires dependencies together in one place.

## Adding A Module

1. Create `src/modules/<module>/domain` for aggregates, events, and ports.
2. Create `src/modules/<module>/application` for commands, queries, handlers, and event handlers.
3. Create `src/modules/<module>/infrastructure` for HTTP routes and adapters.
4. Register handlers and adapters in `src/bootstrap/container.ts`.
5. Register routes in `src/main.ts`.

## Example CQRS Flow

Reading a file goes through `ReadFileQuery`, handled by `ReadFileHandler`. The handler depends on `FilesystemPort`, and the infrastructure adapter `NodeSystemFilesAdapter` performs the actual filesystem operation.

Executing a terminal command goes through `ExecuteTerminalCommand`, handled by `ExecuteTerminalHandler`. The handler depends on `TerminalPort`, and `BunTerminalAdapter` performs the actual process execution.
