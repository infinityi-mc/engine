export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = normalizeHeaders(init.headers);
  headers["content-type"] = "application/json; charset=utf-8";

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function normalizeHeaders(headersInit: ResponseInit["headers"]): Record<string, string> {
  const headers: Record<string, string> = {};

  if (!headersInit) {
    return headers;
  }

  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      headers[key] = value;
    });

    return headers;
  }

  if (Array.isArray(headersInit)) {
    for (const [key, value] of headersInit) {
      headers[key] = value;
    }

    return headers;
  }

  for (const [key, value] of Object.entries(headersInit)) {
    if (typeof value === "string") {
      headers[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
    }
  }

  return headers;
}
