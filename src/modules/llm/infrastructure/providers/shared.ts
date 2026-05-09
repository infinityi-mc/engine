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
