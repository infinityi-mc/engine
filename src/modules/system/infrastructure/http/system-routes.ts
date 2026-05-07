import type { CommandBus } from "../../../../shared/application/command-bus";
import type { QueryBus } from "../../../../shared/application/query-bus";
import { jsonResponse } from "../../../../shared/http/json-response";
import type { JwtGuard } from "../../../../shared/http/jwt-guard";
import { getErrorMessage } from "../../../../shared/observability/error-utils";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { Router } from "../../../../shared/http/router";
import { SCOPES } from "./scopes";
import { CopyPathCommand } from "../../application/commands/copy-path.command";
import { DeletePathCommand } from "../../application/commands/delete-path.command";
import { ExecuteTerminalCommand } from "../../application/commands/execute-terminal.command";
import { MovePathCommand } from "../../application/commands/move-path.command";
import { SedCommand } from "../../application/commands/sed.command";
import { AwkQuery } from "../../application/queries/awk.query";
import { GlobFilesQuery } from "../../application/queries/glob-files.query";
import { GrepFilesQuery } from "../../application/queries/grep-files.query";
import { ListDirectoryQuery } from "../../application/queries/list-directory.query";
import { ReadFileQuery } from "../../application/queries/read-file.query";
import { ClientInputError } from "../../domain/errors/client-input.error";
import { UnsupportedToolError } from "../../domain/errors/unsupported-tool.error";
import type { FileEntry, FileReadResult, GrepMatch } from "../../domain/ports/filesystem.port";
import type { TerminalResult } from "../../domain/ports/terminal.port";

type JsonBody = Record<string, unknown>;
const maxJsonBodyBytes = 1_048_576;
const validEncodings = ["utf8", "utf-8", "utf16le", "utf-16le", "latin1", "base64", "base64url", "hex", "ascii"] as const;
type ValidEncoding = typeof validEncodings[number];

export function registerSystemRoutes(
  router: Router,
  commandBus: CommandBus,
  queryBus: QueryBus,
  guard: JwtGuard,
  logger: LoggerPort,
): void {
  router.post("/system/files/glob", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const pattern = requiredString(body, "pattern");

    if (!pattern.ok) {
      return pattern.response;
    }

    return handleErrors(async () => {
      const cwd = optionalString(body.cwd);
      const maxResults = optionalNumber(body.maxResults);
      const matches = await queryBus.execute<GlobFilesQuery, string[]>(
        new GlobFilesQuery({
          pattern: pattern.value,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(maxResults !== undefined ? { maxResults } : {}),
        }),
      );

      return jsonResponse({ matches });
    }, logger);
  }, SCOPES.FILES_READ));

  router.post("/system/files/grep", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const pattern = requiredString(body, "pattern");

    if (!pattern.ok) {
      return pattern.response;
    }

    return handleErrors(async () => {
      const path = optionalString(body.path);
      const include = optionalString(body.include);
      const caseSensitive = optionalBoolean(body.caseSensitive);
      const maxResults = optionalNumber(body.maxResults);
      const matches = await queryBus.execute<GrepFilesQuery, GrepMatch[]>(
        new GrepFilesQuery({
          pattern: pattern.value,
          ...(path !== undefined ? { path } : {}),
          ...(include !== undefined ? { include } : {}),
          ...(caseSensitive !== undefined ? { caseSensitive } : {}),
          ...(maxResults !== undefined ? { maxResults } : {}),
        }),
      );

      return jsonResponse({ matches });
    }, logger);
  }, SCOPES.FILES_READ));

  router.post("/system/files/list", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const path = requiredString(body, "path");

    if (!path.ok) {
      return path.response;
    }

    return handleErrors(async () => {
      const entries = await queryBus.execute<ListDirectoryQuery, FileEntry[]>(new ListDirectoryQuery(path.value));
      return jsonResponse({ entries });
    }, logger);
  }, SCOPES.FILES_READ));

  router.post("/system/files/read", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const path = requiredString(body, "path");

    if (!path.ok) {
      return path.response;
    }

    return handleErrors(async () => {
      const encoding = optionalEncoding(body.encoding);
      const file = await queryBus.execute<ReadFileQuery, FileReadResult>(
        new ReadFileQuery({ path: path.value, ...(encoding !== undefined ? { encoding } : {}) }),
      );

      return jsonResponse(file);
    }, logger);
  }, SCOPES.FILES_READ));

  router.post("/system/files/awk", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const program = requiredString(body, "program");

    if (!program.ok) {
      return program.response;
    }

    return handleErrors(async () => {
      const result = await queryBus.execute<AwkQuery, TerminalResult>(
        new AwkQuery({
          program: program.value,
          ...optionalStringArrayProperty("files", body.files),
          ...optionalStringProperty("input", body.input),
          ...optionalStringProperty("cwd", body.cwd),
          ...optionalStringArrayProperty("args", body.args),
          ...optionalNumberProperty("timeoutMs", body.timeoutMs),
        }),
      );

      return jsonResponse(result);
    }, logger);
  }, SCOPES.FILES_READ));

  router.post("/system/files/move", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const source = requiredString(body, "source");
    const destination = requiredString(body, "destination");

    if (!source.ok) {
      return source.response;
    }

    if (!destination.ok) {
      return destination.response;
    }

    return handleErrors(async () => {
      await commandBus.execute<MovePathCommand, void>(new MovePathCommand(source.value, destination.value));
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.FILES_WRITE));

  router.post("/system/files/copy", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const source = requiredString(body, "source");
    const destination = requiredString(body, "destination");

    if (!source.ok) {
      return source.response;
    }

    if (!destination.ok) {
      return destination.response;
    }
    return handleErrors(async () => {
      await commandBus.execute<CopyPathCommand, void>(new CopyPathCommand(source.value, destination.value));
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.FILES_WRITE));

  router.post("/system/files/delete", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const path = requiredString(body, "path");

    if (!path.ok) {
      return path.response;
    }

    return handleErrors(async () => {
      await commandBus.execute<DeletePathCommand, void>(
        new DeletePathCommand(path.value, optionalBoolean(body.recursive) ?? false),
      );
      return jsonResponse({ ok: true });
    }, logger);
  }, SCOPES.FILES_WRITE));

  router.post("/system/files/sed", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const script = requiredString(body, "script");

    if (!script.ok) {
      return script.response;
    }

    return handleErrors(async () => {
      const result = await commandBus.execute<SedCommand, TerminalResult>(
        new SedCommand({
          script: script.value,
          ...optionalStringArrayProperty("files", body.files),
          ...optionalStringProperty("input", body.input),
          ...optionalStringProperty("cwd", body.cwd),
          ...optionalStringArrayProperty("args", body.args),
          ...optionalNumberProperty("timeoutMs", body.timeoutMs),
        }),
      );

      return jsonResponse(result);
    }, logger);
  }, SCOPES.FILES_WRITE));

  router.post("/system/terminal/execute", guard.protect(async (request) => {
    const parsed = await parseJson(request);

    if (!parsed.ok) {
      return parsed.response;
    }

    const body = parsed.body;
    const command = requiredString(body, "command");

    if (!command.ok) {
      return command.response;
    }

    return handleErrors(async () => {
      const result = await commandBus.execute<ExecuteTerminalCommand, TerminalResult>(
        new ExecuteTerminalCommand({
          command: command.value,
          ...optionalStringArrayProperty("args", body.args),
          ...optionalStringProperty("cwd", body.cwd),
          ...optionalRecordProperty("env", body.env),
          ...optionalNumberProperty("timeoutMs", body.timeoutMs),
          ...optionalBooleanProperty("shell", body.shell),
          ...optionalStringProperty("input", body.input),
        }),
      );

      return jsonResponse(result);
    }, logger);
  }, SCOPES.TERMINAL_EXECUTE));
}

async function parseJson(request: Request): Promise<{ ok: true; body: JsonBody } | { ok: false; response: Response }> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > maxJsonBodyBytes) {
    return { ok: false, response: jsonResponse({ error: "JSON body is too large" }, { status: 413 }) };
  }

  try {
    const body = await readBodyWithLimit(request);

    if (!body.ok) {
      return body;
    }

    const value = JSON.parse(body.text) as unknown;
    return isRecord(value)
      ? { ok: true, body: value }
      : { ok: false, response: jsonResponse({ error: "JSON body must be an object" }, { status: 400 }) };
  } catch {
    return { ok: false, response: jsonResponse({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

async function readBodyWithLimit(request: Request): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxJsonBodyBytes) {
      await reader.cancel();
      return { ok: false, response: jsonResponse({ error: "JSON body is too large" }, { status: 413 }) };
    }

    chunks.push(value);
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(buffer) };
}

async function handleErrors(action: () => Promise<Response>, logger: LoggerPort): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof UnsupportedToolError) {
      return jsonResponse({ error: "UnsupportedTool", tool: error.tool, message: error.message }, { status: 501 });
    }

    if (error instanceof ClientInputError) {
      return jsonResponse({ error: error.message }, { status: 400 });
    }

    logger.error("http.unexpected_error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return jsonResponse({ error: "Internal Server Error" }, { status: 500 });
  }
}

function requiredString(body: JsonBody, key: string): { ok: true; value: string } | { ok: false; response: Response } {
  const value = body[key];

  if (typeof value !== "string") {
    return { ok: false, response: jsonResponse({ error: `${key} must be a string` }, { status: 400 }) };
  }

  return { ok: true, value };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalEncoding(value: unknown): BufferEncoding | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !validEncodings.includes(value as ValidEncoding)) {
    throw new ClientInputError("encoding must be one of: utf8, utf-8, utf16le, utf-16le, latin1, base64, base64url, hex, ascii");
  }

  return value as BufferEncoding;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalStringProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, string>> {
  const stringValue = optionalString(value);
  return stringValue !== undefined ? { [key]: stringValue } as Record<TKey, string> : {};
}

function optionalBooleanProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, boolean>> {
  const booleanValue = optionalBoolean(value);
  return booleanValue !== undefined ? { [key]: booleanValue } as Record<TKey, boolean> : {};
}

function optionalNumberProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, number>> {
  const numberValue = optionalNumber(value);
  return numberValue !== undefined ? { [key]: numberValue } as Record<TKey, number> : {};
}

function optionalStringArrayProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, string[]>> {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return {};
  }

  return { [key]: value } as Record<TKey, string[]>;
}

function optionalRecordProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, Record<string, string>>> {
  if (!isRecord(value)) {
    return {};
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return { [key]: Object.fromEntries(entries) } as Record<TKey, Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
