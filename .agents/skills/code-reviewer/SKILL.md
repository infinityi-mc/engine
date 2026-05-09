---
name: code-reviewer
description: Review unstaged Bun+TS HTTP API diffs. Hexagonal + CQRS + EDA. 3-lens parallel review → consolidated report.
---


# Code Review — Bun + TypeScript API (Hexagonal + CQRS + EDA)

## Architecture

| Layer | Responsibility |
|-------|---------------|
| **Domain** | Entities, value objects, domain events, repo interfaces. Zero framework imports. |
| **Application** | Command/query handlers. No HTTP types. Plain DTOs in/out. |
| **Infrastructure** | HTTP routes, DB impls, message bus adapters. Thin adapters only. |

**Rules:**
- Domain: no `Bun`, no `Elysia`, no `Hono`, no DB drivers.
- Application: no `Request`/`Response` objects.
- CQRS: commands mutate (return void/Result<void>), queries read (never mutate).
- Events: domain raises, infrastructure subscribes.

## Step 1: Capture Diff

```bash
git diff --unified=5
git diff --cached --unified=5  # if unstaged empty
```

Map files to layers by path: `src/domain/`, `src/application/`, `src/infrastructure/`.

## Step 2: Parallel Review (3 Lenses)

> Small diffs: review directly, no sub-agents.

**Lens A — Architecture:**
- Layer violations (domain→infra imports, handler touching HTTP)
- CQRS purity (commands returning data, queries mutating)
- Event correctness (past-tense naming, payload shape, handler registration)
- Repo interface segregation (domain defines, infra implements)
- Dependency direction (outer→inner only)

**Lens B — Correctness & Safety:**
- Logic errors (inverted conditions, off-by-one, wrong precedence)
- Swallowed errors (empty catch, missing propagation, unhandled rejections)
- Async bugs (missing `await`, race conditions, wrong parallel/sequential)
- Security (injection, XSS, authz bypass, secrets in logs, missing input validation)
- Type safety (no `as any`, no `!` without guard, strict mode, discriminated unions)
- Resource leaks (unclosed connections, missing `finally`, timer leaks)

**Lens C — Quality:**
- Naming (unclear names, inconsistent casing, misleading abbreviations, >40 line functions)
- Performance (N+1 queries, hot path allocations, blocking event loop, missing indexes, unbounded queries)
- Duplication (copy-paste, DRY violations)
- SSOT (magic numbers, scattered config, hardcoded values)
- Dead code (unused imports, unreachable branches, commented blocks, uncalled functions)
- Over-engineering (unnecessary abstractions, YAGNI, single-impl interfaces)
- Tests (missing coverage, brittle assertions, no edge cases, non-behavior assertions)
- Observability (missing error logs, no tracing spans, opaque errors, no metrics)

## Step 3: Consolidate

1. **Deduplicate** — merge same issue across lenses. check `.agents/skills/code-reviewer/invalid-findings.md`
2. **Severity:**
   - **[CRITICAL]** — crash, data loss, security breach, architectural corruption
   - **[WARNING]** — fragility, tech debt, layer smell, missing guard, perf concern
   - **[INFO]** — style, naming, minor improvement
3. **Group by file → line number.**
4. **Format:**
   ```
   <file>:L<line> — [SEVERITY] <category>: <problem>. <fix>.
   ```
   Categories: `arch`, `cqrs`, `event`, `correctness`, `error-handling`, `async`, `security`, `types`, `naming`, `perf`, `duplication`, `ssot`, `dead-code`, `over-engineering`, `tests`, `observability`, `style`

5. **Summary:** files changed, severity counts, 1-2 sentence assessment.

[!IMPORTANT] If no findings, state "no issues found" and stop here.

## Step 4: Export

Write to `.agents\skills\code-reviewer\review-findings.md`:

1. **Header** — `# Code Review Findings` + `YYYY-MM-DD HH:MM UTC`
2. **Summary** — files, counts, assessment
3. **Findings** — deduplicated, grouped by file/line

Overwrite on each run.
---
