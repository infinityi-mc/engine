import {
  ProviderApiError,
  ProviderTimeoutError,
} from "../../domain/errors/llm.errors";

/**
 * Parses the Retry-After header value per RFC 9110.
 * Supports both delta-seconds (e.g. "120") and HTTP-date (e.g. "Sun, 06 Nov 1994 08:49:37 GMT").
 * Returns undefined if the header is absent, empty, or unparseable.
 */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;

  const parsed = Number.parseInt(header, 10);
  if (!Number.isNaN(parsed)) {
    return parsed * 1000;
  }

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return dateMs - Date.now();
  }

  return undefined;
}

/**
 * Wraps fetch with a timeout (default 30s). Translates abort errors into
 * ProviderTimeoutError and network TypeErrors into ProviderApiError.
 */
export async function fetchWithTimeout(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs: number = 30_000,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ProviderTimeoutError(provider, timeoutMs);
    }
    if (err instanceof TypeError) {
      throw new ProviderApiError(
        provider,
        0,
        `Network error: ${err.message}`,
      );
    }
    throw err;
  }
}
