---
description: Review unstaged code changes for Bun + TypeScript HTTP API using Hexagonal Architecture + CQRS + Event-Driven Architecture. Spawns three parallel review agents (architecture, correctness, quality) and consolidates findings.
---

## Code Review — Bun + TypeScript HTTP API (Hexagonal + CQRS + EDA)

### Architecture Context

This review enforces the following layered architecture:

| Layer | Responsibility | Examples |
|-------|---------------|----------|
| **Domain** | Business contracts, entities, value objects, domain events, repository interfaces | `Order`, `OrderCreatedEvent`, `IOrderRepository` |
| **Application** | Use-case handlers / command handlers / query handlers that orchestrate domain logic | `CreateOrderHandler`, `GetOrderQueryHandler` |
| **Infrastructure** | HTTP routes, controllers, DB implementations, message bus adapters, external API clients | `POST /orders` route, `PostgresOrderRepository` |

**Key rules:**
- Domain layer has **zero** framework imports (no `Bun`, no `Elysia`, no `Hono`, no DB drivers).
- Application handlers **never** touch HTTP request/response objects directly — they receive plain DTOs/commands/queries.
- Infrastructure routes are **thin adapters** — parse HTTP input, delegate to application handler, serialize HTTP response.
- CQRS: Commands mutate, queries return data. Never mix.
- Events: Domain events are raised in domain/application layer; infrastructure subscribes and reacts.

---

### Step 1: Capture Unstaged Changes

```bash
git diff --unified=5
```

If the diff is empty, also check staged-but-uncommitted:

```bash
git diff --cached --unified=5
```

Read the full diff. Note which files belong to which architectural layer based on their path conventions (e.g., `src/domain/`, `src/application/`, `src/infrastructure/`).

---

### Step 2: Parallel Triple-Agent Review

Run **three** sub-agent calls with the same search term. Each agent reviews the **entire diff** but with a different primary lens:

**Agent A — Architecture & Contracts Lens:**
Focus on:
- Layer boundary violations (e.g., domain importing infrastructure, handler touching HTTP types)
- CQRS purity (commands returning data, queries mutating state)
- Domain event correctness (event naming, payload shape, handler registration)
- Repository interface segregation (domain defines interface, infra implements)
- Dependency direction (outer → inner, never inner → outer)

**Agent B — Correctness & Safety Lens:**
Focus on:
- **Code correctness** — logic errors, inverted conditions, off-by-one, wrong operator precedence, incorrect boolean expressions
- **Un-handled errors** — swallowed exceptions, empty catch blocks, missing error propagation, unhandled promise rejections
- **Async correctness** — missing `await`, race conditions, `Promise.all` vs sequential where parallel needed, missing abort signal propagation
- **Security** — SQL/NoSQL injection, XSS in responses, authz bypass, secret/key exposure in logs or code, missing input validation/sanitization
- **Type safety** — no `as any`, no `!` non-null assertions without guard, proper generics, `strict: true` compliance, discriminated unions over type casting
- **Resource management** — unclosed DB connections, missing cleanup in `finally`, file handle leaks, timer leaks

**Agent C — Quality & Maintainability Lens:**
Focus on:
- **Naming & readability** — unclear variable/function names, inconsistent casing, misleading abbreviations, functions too long (>40 lines)
- **Performance** — N+1 queries, unnecessary allocations in hot paths, blocking the event loop, missing DB indexes, unbounded queries
- **Duplicated logic** — copy-pasted blocks, DRY violations, identical logic across files that should be extracted
- **SSOT violation** — magic numbers, duplicated constants, config scattered across files, hardcoded values that belong in config
- **Dead code** — unused imports, unreachable branches, commented-out blocks, functions never called
- **Over-engineered** — unnecessary abstractions, premature generalization, YAGNI violations, interfaces with single implementation and no clear future need
- **Test quality** — missing tests for new logic, brittle assertions (snapshot abuse, tight coupling to impl), no edge case coverage, tests that don't assert behavior
- **Observability** — missing logs for error paths, no tracing spans on I/O boundaries, opaque error messages with no context, no metrics for critical operations

All three agents receive the same diff content. Call them sequentially (tool limitation) but treat their outputs as independent parallel reviews.

---

### Step 3: Consolidate & Report

Merge findings from all three agents:

1. **Deduplicate** — if multiple agents flag the same issue, merge into one finding citing all relevant lenses.
2. **Classify severity:**
   - 🔴 **Critical** — will cause crash, data loss, security breach, architectural corruption, or silent data corruption
   - 🟡 **Warning** — fragile, tech debt, layer smell, missing guard, performance concern, observability gap
   - 🔵 **Info** — style, naming, minor improvement, optional simplification
3. **Group by file**, then by line number.
4. **Format each finding:**
   ```
   <file>:L<line> — 🔴/🟡/🔵 <category>: <concise problem>. <concrete fix>.
   ```
   Categories: `arch` (architecture), `cqrs`, `event`, `correctness` (logic bugs), `error-handling`, `async`, `security`, `types`, `naming`, `perf`, `duplication`, `ssot`, `dead-code`, `over-engineering`, `tests`, `observability`, `style`

5. **Summary section** at the top:
   - Files changed: N
   - Critical: N | Warnings: N | Info: N
   - Overall assessment (1–2 sentences)

---

### Step 4: Export Findings

Write the full consolidated report to `g:\engine\.agents\skills\code-reviewer\review-findings.md` using `write_to_file`. The file must contain (in this order):

1. **Header** — `# Code Review Findings` + timestamp (`YYYY-MM-DD HH:MM UTC`)
2. **Summary** — files changed, severity counts, overall assessment
3. **Findings** — all deduplicated findings grouped by file → line number, formatted as:
   ```
   <file>:L<line> — 🔴/🟡/🔵 <category>: <concise problem>. <concrete fix>.
   ```
4. **Architecture Health Score** table
5. **Code Quality Health Score** table
6. **Review Checklist** — copy the checklist with items checked/unchecked based on what was verified in the diff

This file is **overwritten** on every review run — it always reflects the latest review, not a history.

---

### Step 5: Health Scores

#### Architecture Health

Rate each layer on a 1–5 scale:

| Layer | Score | Notes |
|-------|-------|-------|
| Domain purity | /5 | Framework-free? Business logic only? |
| Application orchestration | /5 | Handlers clean? No HTTP coupling? |
| Infrastructure thinness | /5 | Routes truly thin adapters? |
| CQRS adherence | /5 | Commands/queries properly separated? |
| Event flow | /5 | Events well-structured? Subscriptions correct? |

#### Code Quality Health

Rate each dimension on a 1–5 scale:

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | /5 | Logic sound? Edge cases handled? |
| Error resilience | /5 | All errors handled? No swallowed exceptions? |
| Async safety | /5 | No race conditions? Proper abort handling? |
| Security posture | /5 | Inputs validated? No injection vectors? Secrets safe? |
| Type safety | /5 | Strict mode? No escape hatches abused? |
| Readability | /5 | Clear names? Functions focused? |
| Performance | /5 | No N+1? No blocking ops? Efficient queries? |
| DRY / SSOT | /5 | No duplication? Constants centralized? |
| Dead code | /5 | Clean imports? No unreachable branches? |
| Test coverage | /5 | New logic tested? Edge cases covered? |
| Observability | /5 | Errors logged with context? Spans on I/O? Metrics present? |
| Simplicity | /5 | No over-engineering? YAGNI respected? |

---

### Review Checklist (Quick Reference)

**Architecture:**
- [ ] No `import` from outer layer into inner layer
- [ ] No `Request`/`Response` types in application or domain
- [ ] No framework imports in domain (`Bun`, `Elysia`, `Hono`, `Express`, etc.)
- [ ] Command handlers return `void` or `Result<void, Error>` — never data
- [ ] Query handlers never mutate state
- [ ] Domain events use past-tense naming (`OrderCreated`, `PaymentRefunded`)
- [ ] Repository interfaces in domain, implementations in infrastructure
- [ ] Dependency injection flows inward (infra → app → domain)

**Correctness & Safety:**
- [ ] No logic errors (inverted conditions, off-by-one, wrong operators)
- [ ] All errors explicitly handled — no empty catch blocks, no swallowed rejections
- [ ] All `async` calls have `await` (or explicitly stored as Promise)
- [ ] No race conditions — shared mutable state is properly synchronized
- [ ] No SQL/NoSQL injection vectors — parameterized queries only
- [ ] No secrets, keys, or PII in logs or error messages
- [ ] All user input validated and sanitized at the boundary
- [ ] No `as any`, no `!` non-null assertions without guard
- [ ] Resources (connections, files, timers) cleaned up in `finally` or via `using`

**Quality & Maintainability:**
- [ ] Variable/function names are clear and follow project conventions
- [ ] No functions over 40 lines — extract helpers
- [ ] No N+1 queries — batch or join where possible
- [ ] No duplicated logic — extract shared utilities
- [ ] No magic numbers — use named constants or config
- [ ] No dead code — remove unused imports, unreachable branches, commented-out blocks
- [ ] No unnecessary abstractions — YAGNI: don't build it until you need it
- [ ] New logic has tests with edge case coverage
- [ ] Error paths include structured logs with correlation context
- [ ] I/O boundaries (DB, HTTP, queue) have tracing spans
