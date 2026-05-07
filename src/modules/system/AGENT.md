# System Module Notes

This module provides filesystem and terminal capabilities through the project's Hexagonal + CQRS structure.

## Intentional Trust Boundary

The system module intentionally does not enforce sandboxing, path restrictions, command allowlists, or policy constraints within its domain/application layers.

This is a deliberate design choice, not a bug or missing feature.

Callers of this module are responsible for applying constraints before invoking filesystem or terminal operations. This keeps the module focused on capability execution and allows different callers to impose different sandbox policies.

During review, do not flag the absence of sandboxing inside this module as a vulnerability unless a caller incorrectly exposes it without applying the required policy layer.

## API Verification (JWT + Scopes)

All system HTTP endpoints require JWT authentication. The `JwtGuard` (in `src/shared/http/jwt-guard.ts`) wraps each route handler and validates the `Authorization: Bearer <token>` header before dispatching.

### Scope Constants

Defined in `src/modules/system/infrastructure/http/scopes.ts`:

| Scope | Value | Endpoints |
|-------|-------|-----------|
| `FILES_READ` | `system:files:read` | glob, grep, list, read, awk |
| `FILES_WRITE` | `system:files:write` | move, copy, delete, sed |
| `TERMINAL_EXECUTE` | `system:terminal:execute` | terminal/execute |

### How It Works

- `JwtGuard.protect(handler, scope?)` wraps a `RouteHandler` with JWT verification + optional scope check
- Missing/invalid token → `401` with `{ error: "Missing or invalid Authorization header" }` or `{ error: "Invalid or expired token" }`
- Valid token but missing required scope → `403` with `{ error: "Insufficient scope", required, granted }`
- Tokens use HS256 (HMAC-SHA256) with a shared secret from `JWT_SECRET` env var
- Optional `JWT_ISSUER` and `JWT_AUDIENCE` env vars enable `iss`/`aud` claim validation
- The `scope` claim is a space-separated string (e.g., `"system:files:read system:files:write"`) following RFC 8693/OAuth2 convention

### Configuration

| Env Var | Required | Description |
|---------|----------|-------------|
| `JWT_SECRET` | Yes | HMAC shared secret for signing/verification |
| `JWT_ISSUER` | No | Expected `iss` claim value |
| `JWT_AUDIENCE` | No | Expected `aud` claim value |

### Design Notes

- Verification lives in the **infrastructure HTTP layer** (`system-routes.ts`), not in domain/application — keeping the hexagonal boundary clean
- The guard is injected via the DI container (`AppContainer.guard`) and passed to `registerSystemRoutes`
- The `/health` endpoint is intentionally **not** guarded — it serves unauthenticated liveness checks
- Scope assignment is the token issuer's responsibility; this module only verifies that the required scope is present

## Filesystem Port

File discovery and file management are intentionally consolidated under `FilesystemPort`.

The port includes:

- `glob`
- `grep`
- `listDir`
- `readFile`
- `awk`
- `move`
- `copy`
- `delete`
- `sed`

`awk` is intentionally exposed on the discovery/query side because the caller requested this contract and because it is primarily used here for scanning, extracting, and transforming text. Real `awk` can still mutate files through awk-level redirection or `system()` calls. A caller that requires read-only behavior must validate or restrict the awk program before invoking this module.

Commands such as terminal execution and `sed` intentionally return execution results. This project uses CQRS to separate command intent from query intent, but it does not enforce a strict "commands must return void" rule. Returning process metadata/stdout/stderr from execution commands is intentional API behavior.

## Cross-Platform Behavior

Core filesystem operations use Bun/Node APIs and are expected to work on Windows and Linux:

- `glob` uses `Bun.Glob`
- `grep` is implemented in TypeScript
- `listDir` uses `node:fs/promises`
- `readFile` uses `node:fs/promises`
- `move` uses `rename` with copy/delete fallback for cross-device moves
- `copy` uses `cp`/`copyFile`
- `delete` uses `rm`

`glob` is bounded by default to 10,000 results unless the caller provides `maxResults`. This prevents accidental unbounded memory growth from broad patterns like `**/*`.

`grep` treats `pattern` as a regular expression, returns every match per line, and rejects known unsafe regular expression features such as nested quantifiers and backreferences. This is intentional ReDoS hardening, not sandboxing.

Recursive grep discovery is capped at 10,000 files and 64 directory levels by default to avoid unbounded traversal.

Terminal execution uses `Bun.spawn`.

When `TerminalOptions.env` is provided, it is merged on top of the host process environment. This preserves platform command resolution such as `PATH` while allowing callers to override or add variables.

`shell: true` is intended for trusted callers only. On Windows, `cmd.exe` metacharacter handling is complex; callers that accept untrusted arguments should prefer `shell: false` and structured `args`.

HTTP JSON request bodies for system routes are limited to 1 MiB.

## Real Tool Requirement

`sed` and `awk` intentionally call real installed tools instead of implementing partial TypeScript clones.

If the current environment does not provide the required binary, the module throws `UnsupportedToolError`. HTTP routes translate that into a structured `UnsupportedTool` response.

This behavior is expected on Windows environments without Git Bash, MSYS2, Cygwin, WSL, or GNU tools installed.

## Observability Logging

The system module uses `LoggerPort` with a native console-backed adapter by default. Logs are structured JSON to stdout/stderr and are not persisted to disk by this module.

The module intentionally logs safe operation metadata only:

- operation name
- success/failure
- duration
- path metadata
- counts such as `matchCount`, `entryCount`, `filesCount`, and `argsCount`
- terminal command name
- terminal exit code
- error name/message

The module intentionally does not log payloads by default:

- file contents
- `readFile` content
- grep matched text
- terminal stdin/stdout/stderr
- environment variables
- full sed scripts
- full awk programs
- full args arrays

Filesystem discovery successes are logged at `debug`. Filesystem mutations, real `sed`/`awk` execution, and terminal execution are logged at `info` when successful. Expected operational failures, non-zero terminal exits, and unavailable `sed`/`awk` tools are logged at `warn`. Unexpected adapter failures are logged at `error`.

The default log level is `info`. Set `LOG_LEVEL=debug` to include discovery success logs.

## Review Guidance

When reviewing this module, focus on:

- Correct CQRS wiring
- Correct port/adapter boundaries
- Cross-platform behavior for Bun/Node-backed operations
- Clear unsupported-tool behavior for `sed` and `awk`
- Avoiding accidental policy enforcement inside domain/application layers
- Safe metadata-only observability logs
- JWT guard applied to every system route with correct scope
- Scope constants match endpoint risk level (read vs write vs RCE)

Do not require this module's domain/application layers to validate whether a path is safe, whether a command is allowed, or whether an operation is permitted. Those checks belong in the caller or a dedicated policy/sandbox layer. API verification (JWT + scopes) is the infrastructure layer's responsibility and is already enforced at the route level.
