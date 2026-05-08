# Server Module Notes

This module provides low-level server process management through the project's Hexagonal + CQRS structure. It is designed as a foundation for consumer modules (database server, minecraft server, etc.) to build upon.

## Intentional Minimal API

The server module intentionally exposes only the most fundamental lifecycle operations: spawn, kill, list, and status. stdin command execution and log reading are **not** provided by this module.

This is a deliberate design choice, not a missing feature. Consumer modules have domain-specific protocols for interacting with their server types (e.g., database query languages, minecraft RCON, custom admin APIs). Exposing raw stdin/stdout at the core level would leak infrastructure concerns into the domain and force all consumers into a single interaction model.

Consumer modules should compose with this module by:
- Using `ServerProcessPort` to spawn/kill processes
- Using `ServerRegistryPort` to track instances
- Adding their own ports for stdin interaction and log reading specific to their domain

During review, do not flag the absence of stdin or log-reading APIs as missing functionality. Those belong in consumer modules.

## Intentional Trust Boundary

The server module intentionally does not enforce command allowlists, resource limits, or policy constraints within its domain/application layers.

This is a deliberate design choice, not a bug or missing feature.

Callers of this module are responsible for applying constraints before spawning server processes. This keeps the module focused on lifecycle management and allows different callers to impose different sandbox policies.

During review, do not flag the absence of sandboxing inside this module as a vulnerability unless a caller incorrectly exposes it without applying the required policy layer.

## API Verification (JWT + Scopes)

All server HTTP endpoints require JWT authentication. The `JwtGuard` (in `src/shared/http/jwt-guard.ts`) wraps each route handler and validates the `Authorization: Bearer <token>` header before dispatching.

### Scope Constants

Defined in `src/modules/server/infrastructure/http/scopes.ts`:

| Scope | Value | Endpoints |
|-------|-------|-----------|
| `INSTANCE_READ` | `server:instance:read` | list, status |
| `INSTANCE_WRITE` | `server:instance:write` | spawn, kill |

### How It Works

- `JwtGuard.protect(handler, scope?)` wraps a `RouteHandler` with JWT verification + optional scope check
- Missing/invalid token → `401` with `{ error: "Missing or invalid Authorization header" }` or `{ error: "Invalid or expired token" }`
- Valid token but missing required scope → `403` with `{ error: "Insufficient scope", required, granted }`
- Tokens use HS256 (HMAC-SHA256) with a shared secret from `JWT_SECRET` env var
- The `scope` claim is a space-separated string (e.g., `"server:instance:read server:instance:write"`) following RFC 8693/OAuth2 convention

### Design Notes

- Verification lives in the **infrastructure HTTP layer** (`server-routes.ts`), not in domain/application — keeping the hexagonal boundary clean
- The guard is injected via the DI container (`AppContainer.guard`) and passed to `registerServerRoutes`
- Scope assignment is the token issuer's responsibility; this module only verifies that the required scope is present

## Two-Port Architecture

Server process management is split across two ports:

### ServerProcessPort

Owns the subprocess lifecycle — spawn, kill, isAlive, reconcile. Implemented by `BunServerProcessAdapter` which holds `Bun.spawn` subprocess references and PID file state.

- `spawn(input: SpawnInput): Promise<ServerInstance>` — spawns a long-running process, writes PID file, begins exit monitoring
- `kill(instanceId: string): Promise<void>` — terminates the process (SIGTERM→SIGKILL on Unix, taskkill on Windows), removes PID file
- `isAlive(instanceId: string): Promise<boolean>` — checks if the tracked subprocess is still running via signal-0 probe
- `reconcile(registry: ServerRegistryPort): Promise<void>` — scans PID directory on startup, adopts running processes, removes stale PID files

### ServerRegistryPort

Owns instance metadata — register, unregister, get, list, updateStatus. Implemented by `InMemoryServerRegistryAdapter` using a simple `Map`.

- `register(instance: ServerInstance): Promise<void>`
- `unregister(instanceId: string): Promise<void>`
- `get(instanceId: string): Promise<ServerInstance | undefined>`
- `list(): Promise<ServerInstance[]>`
- `updateStatus(instanceId: string, status, stoppedAt?): Promise<void>`

The split is intentional. `ServerProcessPort` manages OS-level process state. `ServerRegistryPort` manages application-level instance metadata. This allows consumer modules to swap the registry (e.g., persistent storage) without changing process management, or swap process management (e.g., Docker, systemd) without changing instance tracking.

## ServerInstance Type

Defined in `src/modules/server/domain/types/server-instance.ts`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Caller-provided unique identifier |
| `pid` | `number` | OS process ID |
| `command` | `string` | Spawned command |
| `args` | `string[]` | Command arguments |
| `cwd` | `string \| undefined` | Working directory |
| `status` | `ServerStatus` | `running \| stopped \| crashed` |
| `startedAt` | `Date` | Spawn timestamp |
| `stoppedAt` | `Date \| undefined` | Stop/crash timestamp |

The `env` field is intentionally **not** stored on `ServerInstance` to prevent credential leaks. Environment variables passed at spawn time may contain secrets (API keys, tokens). Storing them on the entity would risk accidental exposure via `serializeInstance` or future refactors that spread the object. Consumer modules that need to track spawn configuration should store it independently.

## CQRS Wiring

| Type | Constant | Handler | Port Dependencies |
|------|----------|---------|-------------------|
| Command | `server.instance.spawn` | `SpawnServerHandler` | `ServerProcessPort`, `ServerRegistryPort` |
| Command | `server.instance.kill` | `KillServerHandler` | `ServerProcessPort`, `ServerRegistryPort` |
| Query | `server.instance.list` | `ListServersHandler` | `ServerRegistryPort` |
| Query | `server.instance.status` | `GetServerStatusHandler` | `ServerRegistryPort`, `ServerProcessPort` |

`SpawnServerCommand` returns `ServerInstance` rather than `void`. This project uses CQRS to separate command intent from query intent, but it does not enforce a strict "commands must return void" rule. Returning the created instance from spawn is intentional API behavior — callers need the PID and status immediately.

`GetServerStatusHandler` checks liveness before returning status. If the registry says `running` but the process is dead, the handler updates the registry status to `crashed` and returns the corrected state. This is intentional staleness correction, not a side effect in a query handler.

## Orphan Prevention (PID File + Reconcile)

The module uses PID files as the source of truth for crash recovery:

1. **On spawn**: Write `<PID_DIR>/<instanceId>.pid` containing the PID
2. **On kill**: Delete the PID file after process termination
3. **On process exit**: Async `monitorExit` detects exit, updates status to `stopped` (exit code 0) or `crashed` (non-zero), removes PID file
4. **On startup**: `reconcile()` scans PID directory, checks if each PID is alive, adopts running instances into registry, removes stale PID files

### Configuration

| Env Var | Required | Default | Description |
|---------|----------|---------|-------------|
| `PID_DIR` | No | `./pids` | Directory for PID files |

### Reconcile Behavior

- Called in `main.ts` after container creation via `container.serverProcess.reconcile(container.serverRegistry)`
- Adopted instances have `command: "(recovered)"` and `startedAt: new Date()` since the original spawn metadata is lost
- Reconcile is best-effort: errors reading individual PID files are logged at `warn` but do not prevent processing other files
- Reconcile is fire-and-forget in `main.ts` (`.catch()` logged) — it does not block server startup

### Known Limitations

- **PID reuse**: On Unix, PIDs wrap around at ~32K. If the app crashes and a PID is reused by an unrelated process before reconcile runs, the module would incorrectly adopt it. This is a low-probability event. A future enhancement could verify the process command line matches.
- **No graceful shutdown hook**: PID files handle crash recovery, but clean app shutdown does not automatically kill child processes. A `dispose()` method on the process adapter called from a shutdown hook is a planned follow-up.
- **PID file race**: Two app instances sharing the same `PID_DIR` could conflict. Use app-specific `PID_DIR` values or locking for multi-instance deployments.

## Cross-Platform Behavior

Process management uses `Bun.spawn` directly:

- **Spawn**: `Bun.spawn([command, ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })`. Pipes are held open for future consumer module use (stdin interaction, log streaming) but are not exposed by this module's ports.
- **Kill (Unix)**: SIGTERM first, then SIGKILL after 5-second timeout. This gives processes a chance to shut down gracefully.
- **Kill (Windows)**: `taskkill /PID <pid> /T /F` to kill the process tree. Windows has no SIGTERM equivalent; forced termination is the only reliable option.
- **isAlive**: Uses `process.kill(pid, 0)` (signal-0 probe) which works on both Unix and Windows.
- **Env merge**: When `SpawnInput.env` is provided, it is merged on top of the host process environment. This preserves `PATH` resolution while allowing callers to override or add variables.

HTTP JSON request bodies for server routes are limited to 1 MiB.

## HTTP Endpoints

| Method | Path | Scope | Status Codes |
|--------|------|-------|-------------|
| POST | `/server/instances` | `server:instance:write` | `201` created, `400` validation, `409` duplicate ID |
| DELETE | `/server/instances/:id` | `server:instance:write` | `200` killed, `404` not found |
| GET | `/server/instances` | `server:instance:read` | `200` list |
| GET | `/server/instances/:id` | `server:instance:read` | `200` status, `404` not found |

### Error Responses

| Error Class | HTTP Status | JSON `error` Field |
|-------------|-------------|---------------------|
| `ServerNotFoundError` | `404` | `"ServerNotFound"` |
| `ServerAlreadyExistsError` | `409` | `"ServerAlreadyExists"` |
| `ServerProcessError` | `500` | `"ServerProcessError"` |

All error responses include `instanceId` and `message` fields.

## Observability Logging

The server module uses `LoggerPort` with a native console-backed adapter by default. Logs are structured with terminal-colored output to stdout/stderr and are not persisted to disk by this module.

The module intentionally logs safe operation metadata only:

- operation name (`process.spawn`, `process.kill`, `process.exit`, `process.reconcile_*`)
- instance ID
- PID
- command name
- args count
- exit code
- error name/message

The module intentionally does not log payloads by default:

- environment variables
- full args arrays
- subprocess stdout/stderr
- process working directory

Process spawn and kill are logged at `info` when successful. Process exit is logged at `info`. Reconcile adoption and stale cleanup are logged at `info`. Reconcile errors and invalid PID files are logged at `warn`. Spawn failures and kill failures are logged at `error`.

The default log level is `info`. Set `LOG_LEVEL=debug` to include additional detail.

## Consumer Module Guide

To build a domain-specific server module (e.g., database, minecraft) on top of this core:

1. Create `src/modules/<name>/domain` — define domain-specific ports (e.g., `DatabaseAdminPort`, `MinecraftRconPort`)
2. Create `src/modules/<name>/application` — commands/queries that use `ServerProcessPort` and `ServerRegistryPort` for lifecycle, plus domain-specific ports for interaction
3. Create `src/modules/<name>/infrastructure` — adapters that wrap `BunServerProcessAdapter` subprocess references for stdin/stdout access, HTTP routes that compose with server lifecycle endpoints
4. Register handlers and adapters in `src/bootstrap/container.ts`
5. Register routes in `src/main.ts`

Consumer modules should inject `ServerProcessPort` and `ServerRegistryPort` from the container rather than creating their own instances. This ensures all instances are tracked in the shared registry and reconciled on startup.

## Review Guidance

When reviewing this module, focus on:

- Correct CQRS wiring (commands mutate, queries read)
- Correct port/adapter boundaries (domain has no infrastructure imports)
- PID file lifecycle (written on spawn, removed on kill/exit, reconciled on startup)
- Cross-platform kill behavior (SIGTERM/SIGKILL on Unix, taskkill on Windows)
- Safe metadata-only observability logs
- JWT guard applied to every server route with correct scope
- Scope constants match endpoint risk level (read vs write)
- Status staleness correction in `GetServerStatusHandler`
- No stdin/log APIs exposed at the core level (deferred to consumers)

Do not require this module's domain/application layers to validate whether a command is safe, whether a process should be allowed, or whether resource limits should be enforced. Those checks belong in the caller or a dedicated policy layer. API verification (JWT + scopes) is the infrastructure layer's responsibility and is already enforced at the route level.

Do not flag the absence of stdin interaction or log reading as missing functionality. Those are intentionally deferred to consumer modules with domain-specific protocols.
