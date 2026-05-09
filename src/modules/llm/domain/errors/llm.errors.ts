export class ProviderNotFoundError extends Error {
  readonly name = "ProviderNotFoundError";

  constructor(provider: string) {
    super(`Provider not registered: ${provider}`);
  }
}

const REDACT_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /AIza[a-zA-Z0-9_-]{30,}/g,
  /Bearer\s+[a-zA-Z0-9_-]{20,}/gi,
];

function redact(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export class ProviderApiError extends Error {
  readonly name = "ProviderApiError";
  readonly #rawBody: string;

  constructor(
    public readonly provider: string,
    public readonly statusCode: number,
    responseBody: string,
  ) {
    super(`Provider API error [${provider}]: HTTP ${statusCode}`);
    this.#rawBody = responseBody;
  }

  get responseBody(): string {
    return redact(this.#rawBody);
  }

  get rawResponseBody(): string {
    return this.#rawBody;
  }
}

export class ProviderAuthError extends Error {
  readonly name = "ProviderAuthError";

  constructor(provider: string) {
    super(`Authentication failed for provider: ${provider}`);
  }
}

export class ProviderRateLimitError extends Error {
  readonly name = "ProviderRateLimitError";

  constructor(
    public readonly provider: string,
    public readonly retryAfterMs?: number,
  ) {
    const msg = retryAfterMs
      ? `Rate limit exceeded for ${provider}. Retry after ${retryAfterMs}ms`
      : `Rate limit exceeded for ${provider}`;
    super(msg);
  }
}

export class ProviderTimeoutError extends Error {
  readonly name = "ProviderTimeoutError";

  constructor(
    public readonly provider: string,
    public readonly timeoutMs: number,
  ) {
    super(`Request to ${provider} timed out after ${timeoutMs}ms`);
  }
}
