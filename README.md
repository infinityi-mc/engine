# engine

A local-first API server that gives AI agents hands — file access, terminal execution, process management, and code execution — all through a clean HTTP interface.

Built with [Bun](https://bun.sh) and TypeScript. No framework, no unnecessary dependencies.

## What it does

engine exposes six modules as HTTP endpoints:

- **System** — read, write, search, and manipulate files. Run terminal commands.
- **Server** — spawn and manage long-running processes.
- **Minecraft** — create, start, stop, and send commands to Minecraft servers.
- **LLM** — communicate with language models (Anthropic, OpenAI, Google, OpenRouter).
- **Agent** — orchestrate multi-step AI sessions with tool calling. Ships with a `run_python` tool.
- **Mcdoc** — search and browse 1,821 Minecraft Java Edition schemas (read-only).

Every route is JWT-protected with fine-grained scopes. Config is validated on startup and hot-reloaded at runtime.

## Getting started

```bash
bun install
bun run dev
```

The server starts at `http://localhost:3000`. To change it:

```bash
PORT=4000 bun run dev
```

### Configuration

Copy the example config and fill in your API keys:

```bash
cp .env.example .env
```

Then edit `config.json` with your LLM provider keys. API keys can be literal values or environment variable names — engine resolves them at runtime.

### Authentication

Set a JWT secret before using any protected route:

```bash
export JWT_SECRET=your-secret-here
```

Without this, all authenticated requests will be rejected. The `/health` endpoint is the only exception.

## Development

```bash
bun run dev        # start with file watching
bun run start      # start without watching
bun test           # run the test suite
bun run typecheck  # check types
```

Logs go to stdout/stderr. Adjust verbosity:

```bash
LOG_LEVEL=debug bun run dev
```

## Project structure

```
src/
├── bootstrap/       dependency wiring
├── shared/          cross-cutting: HTTP, config, logging, CQRS buses
└── modules/
    ├── system/      file operations + terminal
    ├── server/      process management
    ├── minecraft/   Minecraft server lifecycle
    ├── llm/         LLM provider abstraction
    ├── agent/       agent orchestration + tools
    └── mcdoc/       Minecraft schema search + browse
```

Each module follows hexagonal architecture — domain ports define contracts, infrastructure adapters implement them, application handlers orchestrate the flow. The bootstrap layer wires everything together.

## Current phase

The core infrastructure is in place and functional. All six modules are wired up and responding to requests.

What's working:
- All six modules with JWT-protected endpoints
- Multi-provider LLM communication with tool calling
- Agent orchestration with tool-use loops
- Config hot-reloading via file watcher
- Cross-platform support (Windows + Linux)

What's next:
- More agent tools (file operations, web requests)
- Event-driven features (EventBus and AggregateRoot are scaffolded but not yet wired)
- Persistent agent sessions and conversation history

## License

Private project.
