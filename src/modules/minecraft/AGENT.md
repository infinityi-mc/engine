# Minecraft Module

## Purpose

Owns Minecraft server definitions, process lifecycle orchestration, live logs, metadata, NBT access, and in-game log pattern events.

## Domain Model

types:
  `MinecraftServer`          `domain/types/minecraft-server.ts`
  `PlayerConfig`             `domain/types/minecraft-server.ts`
  `AgentAccess`              `domain/types/minecraft-server.ts`
  `ServerMetadata`           `domain/types/server-metadata.ts`
  `LevelInfo`                `domain/types/server-metadata.ts`

errors:
  `MinecraftServerAlreadyExistsError`   `domain/errors/minecraft-server-already-exists.error.ts`
  `MinecraftServerNotFoundError`        `domain/errors/minecraft-server-not-found.error.ts`
  `MinecraftServerNotRunningError`      `domain/errors/minecraft-server-not-running.error.ts`
  `MinecraftServerRunningError`         `domain/errors/minecraft-server-running.error.ts`
  `ServerPropertiesNotFoundError`       `domain/errors/server-properties-not-found.error.ts`
  `NbtFileNotFoundError`                `domain/errors/nbt-file-not-found.error.ts`
  `NbtPathNotFoundError`                `domain/errors/nbt-path-not-found.error.ts`

## Ports

outbound:
  `MinecraftServerRepositoryPort`   `domain/ports/minecraft-server-repository.port.ts`
  adapters:
    `JsonMinecraftServerRepositoryAdapter`   `infrastructure/persistence/json-minecraft-server-repository.adapter.ts`
  `MinecraftStdinPort`              `domain/ports/minecraft-stdin.port.ts`
  adapters:
    `BunMinecraftStdinAdapter`      `infrastructure/process/bun-minecraft-stdin.adapter.ts`
  `MinecraftLogPort`                `domain/ports/minecraft-log.port.ts`
  adapters:
    `BunMinecraftLogAdapter`        `infrastructure/process/bun-minecraft-log.adapter.ts`
  `PatternRegistryPort`             `domain/ports/pattern-registry.port.ts`
  adapters:
    `InMemoryPatternRegistryAdapter`   `infrastructure/registry/in-memory-pattern-registry.adapter.ts`
  `ServerMetadataPort`              `domain/ports/server-metadata.port.ts`
  adapters:
    `FileSystemServerMetadataAdapter`   `infrastructure/metadata/server-metadata.adapter.ts`
  `NbtPort`                         `domain/ports/nbt.port.ts`
  adapters:
    `PrismarineNbtAdapter`          `infrastructure/nbt/prismarine-nbt.adapter.ts`
  `MinecraftRateLimiterPort`        `domain/ports/minecraft-rate-limiter.port.ts`
  adapters:
    `MinecraftRateLimiterAdapter`   `infrastructure/rate-limit/minecraft-rate-limiter.adapter.ts`
  `MinecraftSessionManagerPort`     `domain/ports/minecraft-session-manager.port.ts`
  adapters:
    `MinecraftSessionManagerAdapter`   `../agent/infrastructure/session/minecraft-session-manager.adapter.ts`
  `LogListenerPort`                 `domain/ports/log-listener.port.ts`
  adapters:
    `MinecraftLogListener`          `infrastructure/listeners/minecraft-log.listener.ts`

## Commands

| Command | Handler | Effect |
|---------|---------|--------|
| `minecraft.server.create` | `application/commands/create-minecraft-server.handler.ts` | persist a server definition |
| `minecraft.server.update` | `application/commands/update-minecraft-server.handler.ts` | patch a server definition; blocks spawn-affecting fields while running |
| `minecraft.server.start` | `application/commands/start-minecraft-server.handler.ts` | spawn Java process, register instance, start log listener |
| `minecraft.server.stop` | `application/commands/stop-minecraft-server.handler.ts` | send `stop`, wait, force-kill if needed, unregister instance |
| `minecraft.server.delete` | `application/commands/delete-minecraft-server.handler.ts` | stop if running, then remove definition |
| `minecraft.server.send-command` | `application/commands/send-minecraft-command.handler.ts` | write command to server stdin |

## Queries

| Query | Handler | Returns |
|-------|---------|---------|
| `minecraft.server.list` | `application/queries/list-minecraft-servers.handler.ts` | `MinecraftServer[]` |
| `minecraft.server.get` | `application/queries/get-minecraft-server.handler.ts` | `MinecraftServerDetails` |
| `minecraft.server.stream-logs` | `application/queries/stream-minecraft-logs.handler.ts` | `ReadableStream<Uint8Array>` SSE stream |
| `minecraft.server.metadata` | `application/queries/get-server-metadata.handler.ts` | `ServerMetadata` |

## Events

emitted:
  `minecraft.log.pattern_matched`   `domain/events/minecraft-log-pattern-matched.event.ts`

handled-by:
  `agent` module `../agent/application/events/minecraft-agent-event.handler.ts`

## HTTP Routes

routes: `infrastructure/http/minecraft-routes.ts`
scopes: `infrastructure/http/scopes.ts`

- `GET /minecraft/servers` requires `minecraft:server:read`.
- `GET /minecraft/servers/:id` requires `minecraft:server:read`.
- `GET /minecraft/servers/:id/metadata` requires `minecraft:server:read`.
- `GET /minecraft/servers/:id/logs` requires `minecraft:server:read`; returns SSE.
- `POST /minecraft/servers` requires `minecraft:server:write`.
- `PATCH /minecraft/servers/:id` requires `minecraft:server:write`.
- `DELETE /minecraft/servers/:id` requires `minecraft:server:write`.
- `POST /minecraft/servers/:id/start` requires `minecraft:server:write`.
- `POST /minecraft/servers/:id/stop` requires `minecraft:server:write`.
- `POST /minecraft/servers/:id/command` requires `minecraft:server:write`.

## Runtime Rules

- Repository persists `DATA_DIR/minecraft/servers.json` with atomic temp-file rename.
- Default server args are `--nogui`; graceful stop timeout is `30_000` ms.
- Start command spawns `javaPath` with `jvmArgs`, `-jar`, `jarFile`, and `serverArgs` in `directory`.
- Stop command sends `stop` through stdin before force-killing through the server process port.
- Delete command treats missing server-registry entries as already stopped.
- `UpdateMinecraftServerHandler` allows `players` updates while running and refreshes the log listener config.
- Running updates cannot change `directory`, `javaPath`, `jarFile`, `jvmArgs`, or `serverArgs`.
- `MinecraftLogListener` parses chat lines with `<player> message`, strips configured team prefixes/suffixes, and publishes pattern matches.
- Container registers pattern `@ai` as `{ action: "invoke_agent", payload: { agentName: "minecraft-ingame" } }`.
- Metadata reads `server.properties` and world `level.dat` through `FileSystemServerMetadataAdapter` and `PrismarineNbtAdapter`.

## Dependencies

consumes:
  `server` module process and registry ports
  `EventBus`      `../../shared/application/event-bus.ts`
  `CommandBus`    `../../shared/application/command-bus.ts`
  `QueryBus`      `../../shared/application/query-bus.ts`
  `JwtGuard`      `../../shared/http/jwt-guard.ts`
  `LoggerPort`    `../../shared/observability/logger.port.ts`

consumed-by:
  `agent` module tools, Minecraft sessions, and `minecraft.log.pattern_matched` handler

## Tests

`../../../test/minecraft/minecraft-module.test.ts`
`../../../test/minecraft/get-server-metadata.handler.test.ts`
`../../../test/minecraft/server-metadata.adapter.test.ts`
`../../../test/minecraft/prismarine-nbt.adapter.test.ts`
`../../../test/minecraft/nbt-tools.test.ts`
`../../../test/minecraft/send-minecraft-commands.tool.test.ts`
