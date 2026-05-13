# LLM Module

## Purpose

Provides a normalized completion API over configured LLM providers for agent runtimes and other application services.

## Domain Model

types:
  `CompletionRequest`    `domain/ports/llm.types.ts`
  `CompletionResponse`   `domain/ports/llm.types.ts`
  `ChatMessage`          `domain/ports/llm.types.ts`
  `ToolDefinition`       `domain/ports/llm.types.ts`
  `ToolCall`             `domain/ports/llm.types.ts`

errors:
  `ProviderNotFoundError`    `domain/errors/llm.errors.ts`
  `ProviderApiError`         `domain/errors/llm.errors.ts`
  `ProviderAuthError`        `domain/errors/llm.errors.ts`
  `ProviderRateLimitError`   `domain/errors/llm.errors.ts`
  `ProviderTimeoutError`     `domain/errors/llm.errors.ts`

## Ports

outbound:
  `LlmProviderPort`      `domain/ports/llm-provider.port.ts`
  adapters:
    `OpenAICompatAdapter`    `infrastructure/providers/openai-compat.adapter.ts`
    `AnthropicAdapter`       `infrastructure/providers/anthropic.adapter.ts`
    `GeminiAdapter`          `infrastructure/providers/gemini.adapter.ts`

## Application

`LlmService` `application/llm.service.ts`

- Resolves missing `provider` and `model` from `ConfigPort.getLlmConfig()`.
- Throws `ProviderNotFoundError` when no adapter is registered for the resolved provider.
- Rejects empty `messages` before calling an adapter.
- Passes generation options, tools, and `providerOptions` through to adapters.
- Logs provider, model, token usage, duration, and optional tool-call count after completion.

## Provider Mapping

`src/bootstrap/container.ts` registers providers from config:

- provider name `anthropic` -> `AnthropicAdapter`
- provider name `google` -> `GeminiAdapter`
- all other provider names -> `OpenAICompatAdapter`

## Adapter Rules

- `OpenAICompatAdapter` posts to `{baseUrl without trailing /v1}/v1/chat/completions`.
- `AnthropicAdapter` posts to `{baseUrl}/v1/messages` and defaults `max_tokens` to `4096`.
- `GeminiAdapter` posts to `{baseUrl}/models/{model}:generateContent`.
- `fetchWithTimeout` in `infrastructure/providers/shared.ts` defaults to `30_000ms` and maps aborts/network failures to provider errors.
- Provider API error bodies are redacted via `ProviderApiError.responseBody`; use `rawResponseBody` only when explicitly safe.

## Dependencies

consumes:
  `ConfigPort`    `../../shared/config/config.port.ts`
  `LoggerPort`    `../../shared/observability/logger.port.ts`

used-by:
  `agent` module via `AgentService`

## Tests

`../../../test/llm/llm.service.test.ts`
