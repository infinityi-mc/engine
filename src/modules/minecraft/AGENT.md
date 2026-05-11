# Minecraft Module Notes

This module provides domain-specific management for Minecraft servers through the project's Hexagonal + CQRS structure. It is built as a consumer of the core `server` module.

## Integration with Server Module

This module intentionally delegates low-level process management (spawn, kill, status) to the core `server` module. It adds Minecraft-specific domain logic on top:
- Tracking server definitions (Java path, JAR file, JVM args, server args, working directory).
- Orchestrating the spawn process via `ServerProcessPort` using the saved definitions.
- Providing domain-specific interactions with the running process: stdin commands and log streaming.

During review, ensure that this module does not attempt to reinvent process lifecycle management and correctly uses `ServerProcessPort` and `ServerRegistryPort`.

## Domain & Ports

The module defines the following Minecraft-specific ports:
- `MinecraftServerRepositoryPort`: Owns the persistence of Minecraft server definitions (`save`, `remove`, `get`, `list`).
- `MinecraftStdinPort`: Owns the capability to send commands directly to the running Minecraft server's stdin (e.g., `/op player`, `/stop`).
- `MinecraftLogPort`: Owns the capability to stream stdout/stderr logs from the running server process.

## API Verification (JWT + Scopes)

All Minecraft HTTP endpoints require JWT authentication. The `JwtGuard` wraps each route handler.

### Scope Constants

Defined in `src/modules/minecraft/infrastructure/http/scopes.ts`:

| Scope | Value | Endpoints |
|-------|-------|-----------|
| `SERVER_READ` | `minecraft:server:read` | list, get, stream logs |
| `SERVER_WRITE` | `minecraft:server:write` | create, delete, start, stop, send command |

## CQRS Wiring

| Type | Name | Handler |
|------|---------------|---------|
| Command | `CreateMinecraftServerCommand` | `CreateMinecraftServerHandler` |
| Command | `UpdateMinecraftServerCommand` | `UpdateMinecraftServerHandler` |
| Command | `DeleteMinecraftServerCommand` | `DeleteMinecraftServerHandler` |
| Command | `StartMinecraftServerCommand` | `StartMinecraftServerHandler` |
| Command | `StopMinecraftServerCommand` | `StopMinecraftServerHandler` |
| Command | `SendMinecraftCommandCommand` | `SendMinecraftCommandHandler` |
| Query | `ListMinecraftServersQuery` | `ListMinecraftServersHandler` |
| Query | `GetMinecraftServerQuery` | `GetMinecraftServerHandler` |
| Query | `StreamMinecraftLogsQuery` | `StreamMinecraftLogsHandler` |

### Start and Stop Commands
- **Start**: Reads the server definition from the repository and uses `ServerProcessPort.spawn` to start the Java process. Registers the process in the `ServerRegistryPort`.
- **Stop**: First attempts a graceful shutdown by sending the `stop` command to the server's stdin using `MinecraftStdinPort` (or relies on it). If the process doesn't exit within the `GRACEFUL_STOP_TIMEOUT_MS`, it delegates to `ServerProcessPort.kill` for a forced termination.

## HTTP Endpoints

| Method | Path | Scope | Status Codes |
|--------|------|-------|-------------|
| POST | `/minecraft/servers` | `minecraft:server:write` | `201` created, `409` already exists |
| PATCH | `/minecraft/servers/:id` | `minecraft:server:write` | `200` updated, `404` not found, `409` server running |
| GET | `/minecraft/servers` | `minecraft:server:read` | `200` list |
| GET | `/minecraft/servers/:id` | `minecraft:server:read` | `200` details |
| DELETE | `/minecraft/servers/:id` | `minecraft:server:write` | `200` ok, `404` not found |
| POST | `/minecraft/servers/:id/start` | `minecraft:server:write` | `201` instance started, `409` already running |
| POST | `/minecraft/servers/:id/stop` | `minecraft:server:write` | `200` ok |
| POST | `/minecraft/servers/:id/command` | `minecraft:server:write` | `200` ok |
| GET | `/minecraft/servers/:id/logs` | `minecraft:server:read` | `200` SSE stream |

### Log Streaming (SSE)
The `GET /minecraft/servers/:id/logs` endpoint uses Server-Sent Events (SSE) to stream live logs to the client. The byte stream from `StreamMinecraftLogsQuery` is decoded and dispatched as individual SSE data messages. Connections are managed appropriately with `abort` signals to prevent dangling readers.

## Error Handling

Standard HTTP mappings for domain errors:
- `MinecraftServerNotFoundError` -> `404`
- `MinecraftServerAlreadyExistsError` -> `409`
- `MinecraftServerRunningError` -> `409`
- `MinecraftServerNotRunningError` -> `409`
- Core server errors (`ServerNotFoundError`, `ServerAlreadyExistsError`) -> mapped to 404/409 appropriately.

## Observability Logging

The minecraft module logs operations using the shared `LoggerPort`.
- Action successes (e.g., spawn, kill, command sent) are typically logged at `info`.
- The log stream SSE connection handles aborts and disconnections cleanly, logging errors at `debug`.
- Route errors catch domain errors to produce clean JSON responses, and log unexpected errors at `error`.

## Review Guidance

When reviewing this module, focus on:
- Correct CQRS wiring.
- Correct integration with the underlying `server` module (using `ServerProcessPort` and `ServerRegistryPort` appropriately, avoiding duplicating process management).
- The graceful stop logic (sending `/stop` via stdin and falling back to process kill).
- Proper management of Server-Sent Events (SSE) lifecycle for log streaming (cleaning up event listeners and readers).
- Safe parameter passing (JVM args, server args) during spawn.
- JWT guard applied to every route with the correct scope (`SERVER_READ` vs `SERVER_WRITE`).
