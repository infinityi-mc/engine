# Agent Module

This module provides high-level agent orchestration — multi-step reasoning loops, tool use, session management, and agentic workflows built on top of the low-level `llm` module.

## Relationship to LLM Module

- The `llm` module handles **low-level LLM API calls** — single request/response completions, provider abstraction, error mapping.
- The `agent` module handles **high-level agent behavior** — multi-turn conversations, tool invocation, reasoning loops, planning, and stateful sessions.

The `agent` module depends on the `llm` module's `LlmService` for making actual LLM calls.

## Phase 1 Scope

This module is currently in planning. The following features are under consideration:

- Tool/function definitions and invocation
- Multi-step reasoning loops (ReAct, chain-of-thought with tool calls)
- Session persistence / conversation history
- Agent memory (short-term and long-term)
- Structured output parsing
- Agent-to-agent communication
- Prompt template management

## Architecture

The module will follow hexagonal architecture with CQRS where appropriate.

```
application/
  commands/           # Agent state mutations
  queries/            # Agent state reads
domain/
  ports/              # Interfaces for persistence, tools, memory
  errors/             # Domain errors
infrastructure/
  http/               # HTTP routes (if exposed)
  adapters/           # Concrete implementations
```

## Status

**Not yet implemented.** This module is a placeholder for future development. See the `llm` module for current LLM calling functionality.
