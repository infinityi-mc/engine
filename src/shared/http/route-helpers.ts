import { jsonResponse } from "./json-response";

export type JsonBody = Record<string, unknown>;

export const maxJsonBodyBytes = 1_048_576;

export async function parseJson(request: Request): Promise<{ ok: true; body: JsonBody } | { ok: false; response: Response }> {
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

export async function readBodyWithLimit(request: Request): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
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

export function requiredString(body: JsonBody, key: string): { ok: true; value: string } | { ok: false; response: Response } {
  const value = body[key];

  if (typeof value !== "string") {
    return { ok: false, response: jsonResponse({ error: `${key} must be a string` }, { status: 400 }) };
  }

  return { ok: true, value };
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionalStringProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, string>> {
  const stringValue = optionalString(value);
  return stringValue !== undefined ? { [key]: stringValue } as Record<TKey, string> : {};
}

export function optionalStringArrayProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, string[]>> {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return {};
  }

  return { [key]: value } as Record<TKey, string[]>;
}

export function optionalRecordProperty<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, Record<string, string>>> {
  if (!isRecord(value)) {
    return {};
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return { [key]: Object.fromEntries(entries) } as Record<TKey, Record<string, string>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
