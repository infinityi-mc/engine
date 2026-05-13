# Agent Module

## Purpose

Owns configured agent definitions, agent sessions, LLM runtime orchestration, tool registry/execution, and Minecraft in-game agent invocation.

## Domain Model

types:
  `AgentDefinition`      `domain/types/agent.types.ts`
  `AgentRuntime`         `domain/types/agent.types.ts`
  `AgentSession`         `domain/types/agent.types.ts`
  `AgentRunResult`       `domain/types/agent.types.ts`
  `InvocationContext`    `domain/types/agent.types.ts`
  `Tool`                 `domain/types/tool.types.ts`
  `ToolContext`          `domain/types/tool.types.ts`
  `ToolResult`           `domain/types/tool.types.ts`

errors:
  `AgentNotFoundError`             `domain/errors/agent.errors.ts`
  `MaxIterationsReachedError`      `domain/errors/agent.errors.ts`
  `SessionTimeoutError`            `domain/errors/agent.errors.ts`
  `SessionNotFoundError`           `domain/errors/session-not-found.error.ts`
  `SessionNotResumableError`       `domain/errors/session-not-resumable.error.ts`

## Ports

outbound:
  `AgentDefinitionRepositoryPort`   `domain/ports/agent-definition-repository.port.ts`
  adapters:
    `ConfigAgentDefinitionRepository`   `infrastructure/persistence/agent-definition-repository.adapter.ts`
  `SessionRepositoryPort`          `domain/ports/session-repository.port.ts`
  adapters:
    `FileSessionRepository`        `infrastructure/persistence/file-session-repository.adapter.ts`
  `ToolRegistryPort`               `domain/ports/tool-registry.port.ts`
  adapters:
    `InMemoryToolRegistry`         `infrastructure/registry/tool-registry.adapter.ts`

## Application Services

`AgentService`          `application/agent.service.ts`
`PromptBuilder`         `application/prompt-builder.ts`
`ToolUseLoop`           `application/runtime/tool-use-loop.ts`
`SingleShotRuntime`     `application/runtime/single-shot.ts`

## HTTP Routes

routes: `infrastructure/http/agent-routes.ts`
scopes: `infrastructure/http/scopes.ts`

- `POST /agent/run` requires `agent:run`.
- `GET /agent/agents` requires `agent:list`.
- `GET /agent/agents/:id` requires `agent:list`.

## Tools

| Tool | Group | File |
|------|-------|------|
| `run_python` | none | `infrastructure/tools/run-python.tool.ts` |
| `read_minecraft_logs` | `minecraft` | `infrastructure/tools/read-minecraft-logs.tool.ts` |
| `minecraft_metadata` | `minecraft` | `infrastructure/tools/minecraft-metadata.tool.ts` |
| `get_player_info` | `minecraft` | `infrastructure/tools/get-player-info.tool.ts` |
| `send_minecraft_commands` | `minecraft` | `infrastructure/tools/send-minecraft-commands.tool.ts` |
| `mcdoc_meta` | `mcdoc` | `infrastructure/tools/mcdoc-tools.ts` |
| `mcdoc_list_packages` | `mcdoc` | `infrastructure/tools/mcdoc-tools.ts` |
| `mcdoc_search` | `mcdoc` | `infrastructure/tools/mcdoc-tools.ts` |
| `mcdoc_get` | `mcdoc` | `infrastructure/tools/mcdoc-tools.ts` |
| `mcdoc_grep_fields` | `mcdoc` | `infrastructure/tools/mcdoc-tools.ts` |
| `mcdoc_find_references` | `mcdoc` | `infrastructure/tools/mcdoc-tools.ts` |
| `nbt_read` | `nbt` | `infrastructure/tools/nbt-tools.ts` |
| `nbt_get` | `nbt` | `infrastructure/tools/nbt-tools.ts` |
| `nbt_search` | `nbt` | `infrastructure/tools/nbt-tools.ts` |
| `nbt_keys` | `nbt` | `infrastructure/tools/nbt-tools.ts` |
| `nbt_structure` | `nbt` | `infrastructure/tools/nbt-tools.ts` |

## Events

handled:
  `minecraft.log.pattern_matched`   from: `minecraft`
  handler:                          `application/events/minecraft-agent-event.handler.ts`

## Runtime Rules

- Agent definitions come from `config.yaml` `agent.agents`; default runtime is `tool-use-loop`.
- Config tool entries may use `group:<name>`; groups are expanded by `ConfigAgentDefinitionRepository` and deduplicated.
- `systemPrompt` may be inline or `file:<relative-path>`; absolute paths and `..` are rejected.
- Supported context blocks are `server`, `player`, and `timestamp`; unresolved blocks are skipped.
- `PromptBuilder` sanitizes server/player context before interpolating it into the system prompt.
- `AgentService.run` creates a session unless `sessionId` is provided; only `completed` or `failed` sessions are resumable.
- Sessions persist as UUID-named JSON files under `DATA_DIR/sessions` using atomic temp-file rename.
- `tool-use-loop` executes LLM tool calls in parallel and saves after every iteration.
- `single-shot` never passes tools to the LLM and completes after one model response.
- Max iteration and timeout failures save partial sessions and surface partial results to HTTP as `200` with `warning`.
- `run_python` writes temp scripts under the OS temp dir, detects `python3` then `python`, and caps timeout at `300_000` ms.
- Minecraft tools can use invocation `serverId`; `get_player_info` can also use invocation `playerName`.
- `send_minecraft_commands` rejects commands matching per-agent blocked prefixes in `MinecraftServer.agents[].commands`.
- Minecraft event handler invokes only action `invoke_agent`, rate-limits by player, checks server agent access, and replies via `tellraw` chunks of 200 chars.
- `MinecraftSessionManagerAdapter` keeps server-to-session mapping in memory and trims non-system messages to config `minecraft.agent.messageCap`.

## Dependencies

consumes:
  `llm` module `LlmService`
  `minecraft` module repository, stdin, log, metadata/player-data queries, NBT, and `minecraft.log.pattern_matched`
  `mcdoc` module repository for mcdoc tools
  `system` module terminal port for `run_python`
  `server` module registry for Minecraft command tools
  `ConfigPort`    `../../shared/config/config.port.ts`
  `JwtGuard`      `../../shared/http/jwt-guard.ts`
  `LoggerPort`    `../../shared/observability/logger.port.ts`

consumed-by:
  `src/bootstrap/container.ts` exposes `agentService`, `toolRegistry`, and `sessionRepository`

## Tests

`../../../test/agent/agent.service.test.ts`
`../../../test/agent/agent-routes.test.ts`
`../../../test/agent/agent-definition-repository.test.ts`
`../../../test/agent/file-session-repository.test.ts`
`../../../test/agent/prompt-builder.test.ts`
`../../../test/agent/run-python.test.ts`
`../../../test/agent/session-resume.test.ts`
`../../../test/agent/single-shot.test.ts`
`../../../test/agent/tool-registry.test.ts`
`../../../test/agent/tool-use-loop.test.ts`
