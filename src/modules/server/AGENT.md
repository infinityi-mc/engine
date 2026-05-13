# Server Module

## Purpose

Manages generic long-running local processes with spawn/kill/status APIs, PID-file recovery, and registry status synchronization.

## Domain Model

types:
  `ServerInstance`   `domain/types/server-instance.ts`
  `ServerStatus`     `domain/types/server-instance.ts`
  `SpawnInput`       `domain/ports/server-process.port.ts`

errors:
  `ServerAlreadyExistsError`   `domain/errors/server-already-exists.error.ts`
  `ServerNotFoundError`        `domain/errors/server-not-found.error.ts`
  `ServerProcessError`         `domain/errors/server-process.error.ts`

## Ports

outbound:
  `ServerProcessPort`    `domain/ports/server-process.port.ts`
  adapters:
    `BunServerProcessAdapter`    `infrastructure/process/bun-server-process.adapter.ts`
  `ServerRegistryPort`   `domain/ports/server-registry.port.ts`
  adapters:
    `InMemoryServerRegistryAdapter`   `infrastructure/registry/in-memory-server-registry.adapter.ts`

## Commands

| Command | Handler | Effect |
|---------|---------|--------|
| `server.instance.spawn` | `application/commands/spawn-server.handler.ts` | spawn process and register instance |
| `server.instance.kill` | `application/commands/kill-server.handler.ts` | kill process and unregister instance |

## Queries

| Query | Handler | Returns |
|-------|---------|---------|
| `server.instance.list` | `application/queries/list-servers.handler.ts` | `ServerInstance[]` |
| `server.instance.status` | `application/queries/get-server-status.handler.ts` | `ServerInstance` |

## Events

emitted:
  `server.process.exited`   `domain/events/server-process-exited.event.ts`

handled:
  `server.process.exited`   from: `server`
  handler:                  `application/events/server-registry-status-sync.handler.ts`

## HTTP Routes

routes: `infrastructure/http/server-routes.ts`
scopes: `infrastructure/http/scopes.ts`

- `POST /server/instances` requires `server:instance:write`.
- `DELETE /server/instances/:id` requires `server:instance:write`.
- `GET /server/instances` requires `server:instance:read`.
- `GET /server/instances/:id` requires `server:instance:read`.

## Runtime Rules

- `SpawnServerHandler` rejects duplicate IDs before spawning.
- `KillServerHandler` requires the instance to exist in `ServerRegistryPort` before killing.
- `BunServerProcessAdapter` writes PID files under `PID_DIR` or `data/pids` using sanitized instance IDs.
- Spawned processes use piped stdin/stdout/stderr and merge custom `env` over host `process.env`.
- Windows kill uses `taskkill /PID <pid> /T /F`; Unix kill sends `SIGTERM`, then `SIGKILL` after 5 seconds.
- Process exits publish `ServerProcessExited`; intentional kills become `stopped`, other nonzero exits become `crashed`.
- `reconcile(registry)` adopts live processes from `.pid` files as `(recovered)` command instances and removes stale/invalid PID files.
- `BunServerProcessAdapter.getSubprocess()` is infrastructure-only support for consumers such as the Minecraft module.

## Dependencies

consumes:
  `EventBus`      `../../shared/application/event-bus.ts`
  `LoggerPort`    `../../shared/observability/logger.port.ts`
  `CommandBus`    `../../shared/application/command-bus.ts`
  `QueryBus`      `../../shared/application/query-bus.ts`
  `JwtGuard`      `../../shared/http/jwt-guard.ts`

consumed-by:
  `minecraft` module for Minecraft server process lifecycle and stdin/stdout access

## Tests

`../../../test/server/server-module.test.ts`
