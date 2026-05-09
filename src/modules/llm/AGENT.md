# LLM Module

This module provides a unified interface for making LLM API calls. It supports two classes of providers:

- **OpenAI-compatible providers** (OpenAI, OpenRouter, LM Studio, Ollama, Groq, Fireworks AI, and any API that speaks the OpenAI Chat Completions format) — handled by a single `OpenAICompatAdapter` parameterized by `baseUrl` + `apiKey`.
- **Dedicated providers** (Anthropic, Google Gemini) — handled by dedicated adapters because their APIs differ fundamentally from OpenAI's.

The module is **not wired through the CQRS command/query buses** — it is a standalone service class instantiated directly from the container.

This is the **low-level LLM calling layer**. For high-level agent orchestration (multi-step reasoning, tool use, session management), see the `agent` module.

## Phase 1 Scope

The module covers non-streaming completions with tool calling. The following are intentionally out of scope and will not be added without an explicit plan:

- Streaming responses
- Session persistence / conversation history
- Retry logic with exponential backoff
- Token counting API
- Prompt caching
- Multi-model fallback
- Rate limiting / circuit breaker
- HTTP response caching

## Architecture

The module follows hexagonal architecture but **not CQRS**. There are no commands or queries — only a direct service class.

```
application/
  llm.service.ts                # LlmService (orchestration)
domain/
  ports/
    llm-provider.port.ts         # LlmProviderPort interface
    llm.types.ts                 # Unified request/response types
  errors/
    llm.errors.ts                # Domain errors
infrastructure/
  providers/
    anthropic.adapter.ts         # Anthropic Messages API (dedicated)
    gemini.adapter.ts            # Google Gemini generateContent API (dedicated)
    openai-compat.adapter.ts     # OpenAI Chat Completions (handles ALL OpenAI-compatible providers)
```

### Domain layer

- `llm.types.ts` defines the unified types based on OpenAI Chat Completions format
- `llm-provider.port.ts` defines the `LlmProviderPort` interface that all adapters implement
- `llm.errors.ts` defines typed domain errors: `ProviderNotFoundError`, `ProviderApiError`, `ProviderAuthError`, `ProviderRateLimitError`

### Application layer

`LlmService` is the orchestration layer. It:
1. Resolves provider from request or config default
2. Resolves model from request or config default
3. Looks up the `LlmProviderPort` adapter from an internal `Map`
4. Delegates to the adapter's `complete()` method
5. Logs provider, model, and token usage
6. Returns a unified `CompletionResponse`

### Infrastructure layer

Each adapter translates the unified request to the provider's native format, makes the API call via `fetch`, translates the response back to the unified format, and handles error mapping.

## Unified Types

### CompletionRequest

```typescript
{
  provider: string;          // e.g. "anthropic", "openai", "google", "openrouter"
  model: string;            // provider-native model name
  messages: ChatMessage[];   // OpenAI format: { role, content, toolCalls?, toolCallId? }
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];  // tool/function definitions for tool calling
  providerOptions?: Record<string, unknown>; // escape hatch for provider-specific features
}
```

`provider` and `model` are **separate fields** — not combined. This allows config defaults to supply either independently.

### CompletionResponse

```typescript
{
  content: string;        // generated text
  reasoning: string;      // thinking text (empty if not available)
  stopReason: "stop" | "length" | "tool_calls" | "error" | "unknown";
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number; // thinking tokens, 0 if not supported
    totalTokens: number;
  };
  model: string;
  provider: string;
  toolCalls?: ToolCall[]; // present when stopReason is "tool_calls"
}
```

## Provider-Specific Options (via providerOptions)

Provider-specific features are passed through without transformation via the `providerOptions` field. The key design decision is that **no thinking abstraction exists** — each provider uses its native config:

| Provider | Option Key | Native Format |
|----------|-----------|---------------|
| Anthropic | `thinking` | `{ type: "enabled", budget_tokens: number }` |
| Anthropic | `outputConfig` | `{ type: "text" }` |
| OpenAI | `reasoning` | `{ effort: "high" \| "medium" \| "low" }` |
| Google Gemini | `thinkingConfig` | `{ thinkingBudget: number }` |

## Tool Calling

Tool calling is supported across all three provider families. The unified types use OpenAI's format as the canonical shape, and each adapter translates to/from the provider's native format.

### Unified Tool Types

```typescript
interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>; // JSON Schema object
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments is JSON string
}
```

### Message Flow

1. **Request**: Pass `tools` array in `CompletionRequest`. The adapter translates to the provider's native format.
2. **Response**: When the model wants to call tools, `stopReason` is `"tool_calls"` and `toolCalls` array is populated in `CompletionResponse`.
3. **Tool execution**: The caller executes the tools and creates `ChatMessage` entries with `role: "tool"`, `toolCallId`, and the result in `content`.
4. **Follow-up**: Pass the full conversation (including tool results) back to `complete()`.

### Provider Tool Calling Translation

#### OpenAI-Compatible

```
Request tools → tools: [{ type: "function", function: { name, description, parameters } }]
Request tool messages → { role: "tool", tool_call_id, content }
Request assistant with tool_calls → { role: "assistant", content: null, tool_calls: [...] }
Response tool_calls → ToolCall[]
Response finish_reason: "tool_calls" → stopReason: "tool_calls"
```

#### Anthropic

```
Request tools → tools: [{ name, description, input_schema }]
Request tool results → wrapped in user message: { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }
Request assistant with tool_calls → { role: "assistant", content: [{ type: "tool_use", id, name, input }] }
Response tool_use content blocks → ToolCall[]
Response stop_reason: "tool_use" → stopReason: "tool_calls"
```

#### Google Gemini

```
Request tools → tools: [{ functionDeclarations: [{ name, description, parameters }] }]
Request tool results → { role: "user", parts: [{ functionResponse: { name, response } }] }
Request assistant with tool_calls → { role: "model", parts: [{ functionCall: { name, args } }] }
Response functionCall parts → ToolCall[] (IDs generated via crypto.randomUUID())
Response finishReason: "STOP" with functionCall parts → stopReason: "tool_calls"
```

## Provider Request/Response Translation

### Anthropic

```
POST {baseUrl}/v1/messages
Headers: x-api-key, anthropic-version: 2023-06-01, content-type
Body: { model, system, messages[{role, content}], max_tokens, temperature, thinking?, output_config? }

Response:
  content[].type: "text"       → content field
  content[].type: "thinking"   → reasoning field
  stop_reason: "end_turn"      → stopReason: "stop"
  stop_reason: "max_tokens"    → stopReason: "length"
  usage.input_tokens           → usage.inputTokens
  usage.output_tokens          → usage.outputTokens
```

### Google Gemini

```
POST {baseUrl}/models/{model}:generateContent
Headers: x-goog-api-key, content-type
Body: { systemInstruction:{parts:[{text}]}, contents[{role, parts:[{text}]}], generationConfig{maxOutputTokens, temperature, thinkingConfig?} }

Response:
  parts[].thought: true     → reasoning field
  parts[].thought: absent   → content field
  finishReason: "STOP"       → stopReason: "stop"
  finishReason: "MAX_TOKENS" → stopReason: "length"
  usageMetadata.promptTokenCount       → inputTokens
  usageMetadata.candidatesTokenCount    → outputTokens
  usageMetadata.thoughtsTokenCount     → reasoningTokens
```

### OpenAI-Compatible (OpenAI, OpenRouter, LM Studio, Ollama, Groq, etc.)

All providers that speak the OpenAI Chat Completions API share the same adapter (`OpenAICompatAdapter`). The `baseUrl` from config is used as-is, with trailing `/v1` stripped automatically to avoid double paths.

```
POST {baseUrl}/v1/chat/completions
Headers: Authorization: Bearer, Content-Type
Body: { model, messages[{role, content}], max_tokens, temperature, reasoning? }

Response:
  choices[].message.content  → content
  choices[].message.reasoning → reasoning
  finish_reason: "stop"      → stopReason: "stop"
  finish_reason: "length"    → stopReason: "length"
  usage.prompt_tokens        → inputTokens
  usage.completion_tokens    → outputTokens
  usage.completion_tokens_details.reasoning_tokens → reasoningTokens
```

To add a new OpenAI-compatible provider, add an entry to `config.json`. No code changes needed.

## Configuration

Provider configs are read from `ConfigPort` via `config.getLlmConfig()`. The config schema includes:

```typescript
{
  llm: {
    defaultProvider: string;     // e.g. "openrouter"
    defaultModel: string;         // e.g. "anthropic/claude-sonnet-4-20250514"
    providers: {
      [name: "anthropic" | "google"]: {
        apiKey: string;
        baseUrl: string;           // e.g. "https://api.anthropic.com"
      }
      [name: string]: {            // any other name = OpenAI-compatible
        apiKey: string;
        baseUrl: string;           // e.g. "https://api.openai.com" or "https://openrouter.ai/api/v1"
      }
    }
  }
}
```

API keys are resolved from the config, which loads them from env vars at startup.

## LlmService Usage

```typescript
const response = await container.llmService.complete({
  messages: [{ role: "user", content: "Hello" }],
  // provider and model are optional — fall back to config defaults
});

console.log(response.content);
console.log(response.usage.totalTokens);
```

## Observability Logging

`LlmService.complete()` logs at `info` level after every call:

```
{ provider: "openai", model: "gpt-4o", inputTokens: 10, outputTokens: 20, reasoningTokens: 5, totalTokens: 35 }
```

Message content and reasoning text are intentionally **not logged** to avoid leaking LLM output and to keep log volume manageable.

## Error Handling

Each adapter maps HTTP status codes to typed domain errors:

| HTTP Status | Error |
|-------------|-------|
| 401 | `ProviderAuthError` |
| 403 (Gemini only) | `ProviderAuthError` |
| 429 | `ProviderRateLimitError` (with optional `retryAfterMs` from `retry-after` header) |
| Other non-ok | `ProviderApiError` (with status code and response body) |

`LlmService.complete()` throws `ProviderNotFoundError` when the resolved provider has no registered adapter.

## Review Guidance

When reviewing this module, focus on:

- Correct request/response translation per provider API spec
- Reasoning text captured when available, empty string when not
- Token usage correctly mapped for all providers (including reasoning tokens)
- `providerOptions` passed through without transformation
- Error mapping covers all relevant HTTP status codes per provider
- `LlmService` resolves provider/model from request or config defaults
- No thinking abstraction — provider-native config only via `providerOptions`
- Logs do not include message content or reasoning text
- Tool definitions correctly translated per provider format
- Tool calls extracted from response with correct IDs (generated for Gemini)
- Tool result messages correctly wrapped per provider format (Anthropic: user message with tool_result blocks)
- `stopReason: "tool_calls"` correctly mapped from provider-native stop reasons

Do not flag the absence of streaming, session persistence, or retry logic. Those are out of scope for Phase 1.
