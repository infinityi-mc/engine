# System Module

## Purpose

Provides local filesystem, text search/transform, and terminal execution capabilities behind CQRS handlers and JWT-scoped HTTP routes.

## Domain Model

types:
  `FileEntry`         `domain/ports/filesystem.port.ts`
  `GrepMatch`         `domain/ports/filesystem.port.ts`
  `FileReadResult`    `domain/ports/filesystem.port.ts`
  `TerminalOptions`   `domain/ports/terminal.port.ts`
  `TerminalResult`    `domain/ports/terminal.port.ts`

errors:
  `ClientInputError`       `domain/errors/client-input.error.ts`
  `UnsupportedToolError`   `domain/errors/unsupported-tool.error.ts`

## Ports

outbound:
  `FilesystemPort`    `domain/ports/filesystem.port.ts`
  adapters:
    `NodeSystemFilesAdapter`   `infrastructure/filesystem/node-system-files.adapter.ts`
  `TerminalPort`      `domain/ports/terminal.port.ts`
  adapters:
    `BunTerminalAdapter`       `infrastructure/terminal/bun-terminal.adapter.ts`

## Commands

| Command | Handler | Effect |
|---------|---------|--------|
| `system.files.copy` | `application/commands/copy-path.handler.ts` | copy file or directory |
| `system.files.delete` | `application/commands/delete-path.handler.ts` | delete path, optional recursive |
| `system.files.move` | `application/commands/move-path.handler.ts` | rename or copy-delete across devices |
| `system.files.sed` | `application/commands/sed.handler.ts` | run local `sed` |
| `system.terminal.execute` | `application/commands/execute-terminal.handler.ts` | run local process |

## Queries

| Query | Handler | Returns |
|-------|---------|---------|
| `system.files.awk` | `application/queries/awk.handler.ts` | `TerminalResult` |
| `system.files.glob` | `application/queries/glob-files.handler.ts` | `string[]` |
| `system.files.grep` | `application/queries/grep-files.handler.ts` | `GrepMatch[]` |
| `system.files.list-directory` | `application/queries/list-directory.handler.ts` | `FileEntry[]` |
| `system.files.read` | `application/queries/read-file.handler.ts` | `FileReadResult` |

## HTTP Routes

routes: `infrastructure/http/system-routes.ts`
scopes: `infrastructure/http/scopes.ts`

- `POST /system/files/glob` requires `system:files:read`.
- `POST /system/files/grep` requires `system:files:read`.
- `POST /system/files/list` requires `system:files:read`.
- `POST /system/files/read` requires `system:files:read`.
- `POST /system/files/awk` requires `system:files:read`.
- `POST /system/files/move` requires `system:files:write`.
- `POST /system/files/copy` requires `system:files:write`.
- `POST /system/files/delete` requires `system:files:write`.
- `POST /system/files/sed` requires `system:files:write`.
- `POST /system/terminal/execute` requires `system:terminal:execute`.

## Adapter Rules

- `glob` uses `Bun.Glob`; default max results is `10_000`.
- `grep` validates regexes with `shared/validation/regex-safety.ts`; default recursive limits are `10_000` files and depth `64`.
- `grep` returns all matches per line with 1-based `lineNumber` and `column`; unreadable files are skipped with debug logs.
- `readFile` defaults to `utf8`; HTTP accepts only encodings listed in `system-routes.ts`.
- `awk` and `sed` require the local executables; missing tools raise `UnsupportedToolError` and HTTP returns `501`.
- `BunTerminalAdapter` runs without shell by default; `shell: true` uses `cmd.exe /d /s /c` on Windows or `/bin/sh -lc` elsewhere.
- Terminal `env` is merged over host `process.env`; timeout aborts throw `Command timed out after <timeoutMs>ms`.
- Mutating operations log at info on success and warn/error on failures.

## Dependencies

consumes:
  `LoggerPort`    `../../shared/observability/logger.port.ts`
  `CommandBus`    `../../shared/application/command-bus.ts`
  `QueryBus`      `../../shared/application/query-bus.ts`
  `JwtGuard`      `../../shared/http/jwt-guard.ts`

## Tests

`../../../test/system/system-module.test.ts`
