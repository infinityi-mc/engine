const MAX_PATTERN_LENGTH = 500;

export class RegexSafetyError extends Error {
  readonly name = "RegexSafetyError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Returns an error message if the pattern is unsafe, or undefined if safe.
 * Pure validation — callers throw their own domain-specific error.
 */
export function validateRegexPattern(
  pattern: string,
): string | undefined {
  if (!pattern) {
    return "pattern is required";
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `pattern must be ${MAX_PATTERN_LENGTH} characters or fewer`;
  }
  if (/(\([^)]*[+*][^)]*\))[+*{]/.test(pattern)) {
    return "pattern contains an unsafe nested quantifier";
  }
  if (/\\[1-9]/.test(pattern)) {
    return "backreferences are not supported";
  }
  return undefined;
}

/**
 * Asserts regex safety, throwing RegexSafetyError on failure.
 * Use when no domain-specific error type is needed.
 */
export function assertSafeRegexPattern(pattern: string): void {
  const error = validateRegexPattern(pattern);
  if (error !== undefined) {
    throw new RegexSafetyError(error);
  }
}
