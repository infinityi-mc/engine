# Agent Module

This module provides high-level agent orchestration — multi-step reasoning, tool invocation, and session management — built on top of the `llm` module's `LlmService`.

An **Agent** is an autonomous entity that uses an LLM as its reasoning engine to accomplish goals. It uses the LLM provider's native tool calling to decide when and how to act.

The module is **not wired through the CQRS command/query buses** — it is a standalone service class (`AgentService`) instantiated directly from the container, following the same pattern as the `llm` module.

## Phase 1 Scope

The module covers:

- Predefined agent definitions loaded from `config.json`
- Tool-use loop runtime (multi-step reasoning with tool calling)
- Single-shot runtime (one LLM call, no tools)
- Declarative context injection via PromptBuilder (server, player, timestamp)
- In-memory sessions (no persistence)
- Tool registry for resolving tool names to implementations
- HTTP routes for running agents and listing definitions

The following are intentionally out of scope and will not be added without an explicit plan:

- Session persistence (writing session history to disk)
- Memory (episodic, semantic — persistent knowledge across sessions)
- Multi-agent delegation (coordinator/specialist pattern)
- Dynamic agent creation via API
- Streaming agent responses
- Retry logic for LLM calls within the loop
- Token counting / context window management

## Architecture

The module follows hexagonal architecture but **not CQRS**. There are no commands or queries — only a direct service class with runtime strategies.

```
application/
  agent.service.ts              # AgentService (orchestration entry point)
  runtime/
    tool-use-loop.ts            # ToolUseLoop (multi-step reasoning loop)
    single-shot.ts              # SingleShotRuntime (one-shot, no tools)
  prompt-builder.ts             # PromptBuilder (system prompt context injection)
domain/
  types/
    agent.types.ts              # AgentDefinition, AgentSession, AgentRunResult
    tool.types.ts               # Tool, ToolResult
  ports/
    tool-registry.port.ts       # ToolRegistryPort interface
    agent-definition-repository.port.ts  # AgentDefinitionRepositoryPort interface
  errors/
    agent.errors.ts             # Domain errors
infrastructure/
  registry/
    tool-registry.adapter.ts    # InMemoryToolRegistry
  persistence/
    agent-definition-repository.adapter.ts  # ConfigAgentDefinitionRepository
  http/
    agent-routes.ts             # HTTP routes
    scopes.ts                   # JWT scope constants
```

### Domain layer

- `agent.types.ts` defines `AgentDefinition` (blueprint), `AgentSession` (runtime state), `AgentRunResult` (output)
- `tool.types.ts` defines `Tool` (named capability) and `ToolResult` (tool execution output)
- `tool-registry.port.ts` defines the `ToolRegistryPort` interface for looking up tools by name
- `agent-definition-repository.port.ts` defines the `AgentDefinitionRepositoryPort` interface for loading agent definitions
- `agent.errors.ts` defines typed domain errors: `AgentNotFoundError`, `MaxIterationsReachedError`, `SessionTimeoutError`

### Application layer

`AgentService` is the orchestration entry point. It:
1. Looks up the agent definition from the repository
2. Creates an in-memory session with system prompt + user message
3. Assembles the system prompt via `PromptBuilder` using optional `InvocationContext`
4. Selects the runtime strategy (tool-use-loop or single-shot)
5. Delegates to the runtime
6. Returns an `AgentRunResult`

`ToolUseLoop` is the core multi-step reasoning engine. It:
1. Converts agent's tool names → `ToolDefinition[]` via the registry
2. Calls `LlmService.complete()` with messages + tool definitions
3. If the LLM returns tool calls: validates input, executes all calls in parallel, appends results, repeats
4. If the LLM returns a final answer: completes the session
5. Enforces max iterations and timeout safety limits
6. LLM errors (auth, provider not found, rate limit) are fatal — fail the session immediately
7. Tool errors are recoverable — reported back to the LLM as tool results

`SingleShotRuntime` is a simple one-call strategy with no tools and no loop. Equivalent to `LlmService.complete()` with a system prompt.

### Infrastructure layer

- `InMemoryToolRegistry` implements `ToolRegistryPort` using a `Map<string, Tool>`
- `ConfigAgentDefinitionRepository` implements `AgentDefinitionRepositoryPort` by reading from `ConfigPort.getAgentConfig()`
- HTTP routes expose `POST /agent/run`, `GET /agent/agents`, `GET /agent/agents/:id`

## Core Types

### AgentDefinition

```typescript
{
  id: string;                    // unique identifier (e.g. "code-reviewer")
  name: string;                  // human-readable display name
  description: string;           // what this agent does
  systemPrompt: string;          // instructions defining agent behavior
  model?: {                      // optional override for LLM provider/model
    provider: string;
    model: string;
  };
  tools: string[];               // tool names from registry
  runtime: "tool-use-loop" | "single-shot";
  maxIterations?: number;        // safety limit for reasoning loop
  temperature?: number;          // LLM temperature
  maxTokens?: number;            // max tokens per LLM response
  context?: Array<{              // declarative context blocks
    type: "server" | "player" | "timestamp";
  }>;
}
```

### AgentSession

```typescript
{
  sessionId: string;             // UUID
  agentId: string;               // which agent definition
  messages: ChatMessage[];        // conversation history
  status: "active" | "completed" | "failed" | "cancelled";
  createdAt: number;              // timestamp
  completedAt: number | null;    // timestamp
  usage: TokenUsage;             // cumulative token usage
  iterationCount: number;        // number of loop iterations
}
```

### AgentRunResult

```typescript
{
  content: string;               // final response text
  reasoning: string;             // thinking text (empty if not available)
  status: SessionStatus;         // final session status
  totalIterations: number;       // how many loop iterations ran
  usage: TokenUsage;             // cumulative token usage
  stopReason: string;            // why the session ended
}
```

### Tool

```typescript
{
  name: string;                  // unique identifier
  description: string;           // what the tool does (shown to LLM)
  inputSchema: Record<string, unknown>;  // JSON Schema for parameters
  execute(input: unknown): Promise<ToolResult>;
}
```

### ToolResult

```typescript
{
  output: string;                // text returned to the LLM
  isError?: boolean;             // true if execution failed
  metadata?: Record<string, unknown>;  // for logging, not shown to LLM
}
```

## Tool-Use Loop

The tool-use loop is the default runtime strategy. It orchestrates the call-execute-feed-back cycle:

```
1. Build request: messages + tool definitions
2. Call LlmService.complete(request)
3. Response contains tool calls?
   ├── Yes: execute all tool calls in parallel (Promise.allSettled),
   │        append all results as tool messages, go to step 2
   └── No: return response to caller (final answer)
```

### Parallel Tool Calling

When the LLM returns multiple tool calls in a single response, the runtime executes them all in parallel using `Promise.allSettled`. This is **provider-driven parallelism** — the LLM decides when to call multiple tools at once.

- Independent tool calls are executed concurrently for efficiency.
- If any tool call fails, its error is captured as a tool result. Other calls continue.
- All results (successes and failures) are sent back to the LLM in one batch.

### Stop Conditions

| Condition | Trigger | Result |
|-----------|---------|--------|
| `stop` | LLM produces a final response without tool calls | Normal completion |
| `maxIterations` | Safety limit reached | `MaxIterationsReachedError` with partial result |
| `timeout` | Session exceeded wall-clock time | `SessionTimeoutError` with partial result |

Tool execution errors are **not** stop conditions. When a tool fails, the error is reported back to the LLM as a tool result with `isError: true`. The LLM decides how to recover.

### Error Handling

**LLM errors are fatal** — the agent cannot reason without an LLM:

| Error | Response |
|-------|----------|
| `ProviderAuthError` | Fail session immediately |
| `ProviderNotFoundError` | Fail session immediately (configuration error) |
| `ProviderRateLimitError` | Fail session immediately |

**Tool errors are recoverable** — reported back to the LLM:

| Scenario | What happens |
|----------|--------------|
| Tool throws an exception | Runtime catches it, sends error message as tool result |
| Tool returns `isError: true` | Error result is sent to LLM as-is |
| Tool not found in registry | Runtime sends "tool not found" error as tool result |
| Invalid JSON in tool arguments | Runtime sends validation error as tool result |

All error recovery is LLM-driven. The runtime's job is to report errors accurately and let the LLM decide the next step.

## Context Injection

The `PromptBuilder` centralizes the assembly of system prompts. It allows agents to declare which environmental context blocks they need.

### Supported Blocks

| Block | Type | Required Data | Description |
|-------|------|---------------|-------------|
| **Current Server** | `server` | `serverId` | Injects server ID and Name (if found in registry) |
| **Calling Player** | `player` | `playerName` | Injects the name of the player invoking the agent |
| **Current Time** | `timestamp` | (none) | Injects the current ISO timestamp |

### Invocation Context

When calling `AgentService.run()`, an `InvocationContext` object can be provided:

```typescript
{
  serverId?: string;
  playerName?: string;
}
```

If a declared block lacks its required data (e.g., `server` block without `serverId`), it is silently skipped to allow the prompt to degrade gracefully. All context values are sanitized to prevent prompt injection attacks (stripping newlines and control characters).

## Configuration

Agent configuration is an optional section in `config.json`:

```typescript
{
  agent: {
    defaultMaxIterations: number;       // e.g. 10
    defaultTimeoutMs: number;           // e.g. 300000 (5 min)
    agents: {
      [id: string]: {
        name: string;
        description: string;
        systemPrompt: string;           // inline or file path (e.g. "file:prompts/code-reviewer.md")
        model?: { provider: string; model: string; };
        tools: string[];                // tool names from registry
        runtime?: "tool-use-loop" | "single-shot";
        maxIterations?: number;
        temperature?: number;
        maxTokens?: number;
      };
    };
  };
}
```

The `agent` section is optional. Existing configs without it continue to work.

System prompts can be defined inline in config or loaded from a file path (prefixed with `file:`). This keeps long prompts out of the config file and allows them to be versioned separately.

### Resolution Order

For `maxIterations` and `timeoutMs`, the resolution order is:
1. Per-request override (passed to `AgentService.run()`)
2. Per-agent definition override (from config)
3. Global default (from `agent.defaultMaxIterations` / `agent.defaultTimeoutMs`)
4. Hardcoded fallback (10 iterations, 300_000ms)

## HTTP Endpoints

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| POST | `/agent/run` | `agent:run` | Run an agent session |
| GET | `/agent/agents` | `agent:list` | List available agent definitions |
| GET | `/agent/agents/:id` | `agent:list` | Get single agent definition |

### POST /agent/run

Request body:
```json
{
  "agentId": "code-reviewer",
  "message": "Review the changes in src/main.ts",
  "maxIterations": 5,
  "timeoutMs": 60000,
  "context": {
    "serverId": "vanilla",
    "playerName": "Steve"
  }
}
```

Response (success):
```json
{
  "content": "I've reviewed the changes...",
  "reasoning": "",
  "status": "completed",
  "totalIterations": 3,
  "usage": { "inputTokens": 500, "outputTokens": 200, "reasoningTokens": 0, "totalTokens": 700 },
  "stopReason": "stop"
}
```

Response (max iterations reached):
```json
{
  "content": "Partial response...",
  "status": "failed",
  "totalIterations": 10,
  "usage": { ... },
  "stopReason": "max_iterations",
  "warning": "Agent reached maximum iterations (10)"
}
```

### Error Responses

| Error | HTTP Status | JSON `error` Field |
|-------|-------------|---------------------|
| `AgentNotFoundError` | `404` | `"AgentNotFound"` |
| `MaxIterationsReachedError` | `200` | (partial result with `stopReason: "max_iterations"`) |
| `SessionTimeoutError` | `200` | (partial result with `stopReason: "timeout"`) |
| `ProviderAuthError` | `502` | `"ProviderAuthError"` |
| `ProviderRateLimitError` | `502` | `"ProviderRateLimitError"` |
| `ProviderNotFoundError` | `502` | `"ProviderNotFoundError"` |

Max iterations and timeout return HTTP 200 with partial results because the agent did produce output — it just didn't finish cleanly. The `warning` field and `stopReason` communicate the abnormal termination.

## Tool Registry

The `InMemoryToolRegistry` maps tool names to their implementations. Tools are registered once at startup (from the container bootstrap) and shared across all agents.

Agents reference tools **by name** in their definition. The registry resolves names to actual tool instances at runtime. An agent can only use tools that exist in the registry. Requesting an unknown tool produces a "tool not found" error that is reported back to the LLM.

Phase 1 ships with an empty registry. Tool implementations (filesystem, terminal, etc.) will be added as a follow-up.

## Observability

Agent logging follows the project's existing conventions (`LoggerPort`, safe metadata only, no payload leakage).

### What Gets Logged

| Event | Level | Data Logged |
|-------|-------|-------------|
| Session created | `info` | session id, agent id |
| Iteration started | `debug` | session id, iteration number |
| LLM call completed | `info` | provider, model, token usage (from LlmService) |
| Tool call started | `debug` | tool name, session id |
| Tool call completed | `info` | tool name, success/failure |
| Session completed | `info` | session id, final status, total iterations, total tokens |
| Max iterations reached | `warn` | session id, max iterations, total tokens |
| Definitions loaded | `info` | count of definitions |

### What Does NOT Get Logged

- Message content (user input, LLM output, reasoning text)
- Tool input/output payloads
- System prompt text
- Tool arguments

This matches the `llm` module's logging philosophy: metadata only, never payloads.

## Relationship to LLM Module

The agent module depends on the `llm` module for all provider-specific functionality:

```
Agent Runtime
  uses unified types: ToolDefinition, ToolCall, ChatMessage
    → LlmService
      → Provider Adapter
        translates to native format
          → Provider API
```

**The agent runtime never sees provider-specific formats.** It works only with the unified types defined in the `llm` module. When you switch providers (e.g., OpenAI → Anthropic), no agent code changes — only the config.

## Review Guidance

When reviewing this module, focus on:

- Agent definitions are separate from agent instances. Definitions live in config; instances are created per session.
- Tools are referenced by name and resolved from a registry, not hardcoded in agent logic.
- The tool-use loop has explicit stop conditions (max iterations, timeout, stop reason).
- The runtime never parses free-form text for tool calls — it uses structured data from the provider API.
- Multiple tool calls in a single response are executed in parallel (`Promise.allSettled`), not sequentially.
- A failed tool call does not abort other calls in the same batch — each runs independently.
- Tool errors are reported back to the LLM as tool results, not swallowed or hardcoded.
- Tool result output is always a string (serialized if complex).
- LLM errors are fatal to the session.
- Logging includes only metadata — never message content or tool payloads.
- The `llm` module owns all provider-specific knowledge; the agent module remains provider-agnostic.

Do not flag the absence of session persistence, memory, multi-agent delegation, or streaming. Those are out of scope for Phase 1.
