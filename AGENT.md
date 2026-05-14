# AGENT.md

## Stack

runtime: Bun
language: TypeScript ESM, strict mode
api dev: `bun run dev`
api start: `bun run start`
test: `bun test`
typecheck: `bun run typecheck`
web dev: `cd apps/web && bun run dev`
web build: `cd apps/web && bun run build`
web check: `cd apps/web && bun run check`

## Architecture

pattern: hexagonal modules with CQRS buses and domain events
api entry: `src/main.ts`
composition root: `src/bootstrap/container.ts`
api config: `config.yaml`, loaded by `src/shared/config/config.adapter.ts`
web entry: `apps/web/src/routes/`, SvelteKit static adapter

## Structure

`src/bootstrap/` dependency wiring and runtime container
`src/shared/` cross-cutting HTTP, config, buses, validation, logging
`src/modules/` domain modules with application/domain/infrastructure layers
`apps/web/` SvelteKit 5 UI using Tailwind CSS and TanStack Svelte Query
`test/` Bun tests matching source module boundaries
`docs/` long-form module and API references
`data/` runtime state, Minecraft schema index, sessions, PID files

## Conventions

- Use explicit `.ts`-less relative imports, matching existing source style.
- Keep domain contracts in `domain/ports`; implement them in `infrastructure` adapters.
- HTTP routes parse/validate input, call `CommandBus`/`QueryBus` or service APIs, and map domain errors to JSON responses.
- Register new handlers, adapters, tools, and event subscribers in `src/bootstrap/container.ts`.
- Protect all API routes with `JwtGuard.protect` except `/health`.
- Use `jsonResponse` and `route-helpers` for API response/input handling.
- Keep persisted runtime data under `DATA_DIR` or `data/`; PID files default to `data/pids`.
- Web API calls use `apps/web/src/lib/config/engine-url.ts`; default backend URL is `/api`.
- Do not commit secrets from `.env`; `config.yaml` may reference environment variable names for provider keys.

## Dependency Rules

- Allowed: infrastructure/http -> application -> domain.
- Allowed: infrastructure adapters -> domain ports and application services.
- Allowed: `src/bootstrap/container.ts` wires across modules.
- Forbidden: domain importing application, infrastructure, HTTP, Bun runtime, or other module internals.
- Cross-module behavior should use public types, ports, commands/queries, or domain events; avoid reaching into another module's infrastructure.

## Environment

`PORT` API port, default `3000`
`HOST` API host, default `localhost`
`JWT_SECRET` required for protected routes
`JWT_ISSUER`, `JWT_AUDIENCE` optional JWT validation constraints
`DATA_DIR` runtime data root, default `data`
`PID_DIR` process PID root, default `data/pids`
`LOG_LEVEL` logger verbosity, default `info`
`PUBLIC_ENGINE_URL` web backend URL override
`PUBLIC_JWT_TOKEN` web token override

## Modules

audioPlayer `src/modules/audioplayer/` downloaded music store, YouTube-backed downloads, Minecraft audioplayer playback API
agent `src/modules/agent/` agent definitions, sessions, runtimes, tools, HTTP agent API
llm `src/modules/llm/` provider abstraction and OpenAI-compatible/Anthropic/Gemini adapters
minecraft `src/modules/minecraft/` Minecraft server definitions, lifecycle, logs, metadata, in-game events
server `src/modules/server/` long-running process spawn/kill/status registry
system `src/modules/system/` filesystem, search, text transforms, terminal execution
youtube `src/modules/youtube/` low-level YouTube search, metadata, download, and managed yt-dlp binary

## Shared Infrastructure

`CommandBus` `src/shared/application/command-bus.ts`
`QueryBus` `src/shared/application/query-bus.ts`
`EventBus` `src/shared/application/event-bus.ts`
`Router` `src/shared/http/router.ts`
`JwtGuard` `src/shared/http/jwt-guard.ts`
`ConfigPort` `src/shared/config/config.port.ts`
`LoggerPort` `src/shared/observability/logger.port.ts`
