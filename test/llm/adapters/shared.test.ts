import { describe, expect, test } from "bun:test";
import { parseRetryAfterMs } from "../../../src/modules/llm/infrastructure/providers/shared";

describe("parseRetryAfterMs", () => {
  test("returns undefined for null header", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(parseRetryAfterMs("")).toBeUndefined();
  });

  test("parses delta-seconds as milliseconds", () => {
    const result = parseRetryAfterMs("120");
    expect(result).toBe(120_000);
  });

  test("parses single-digit delta-seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5_000);
  });

  test("returns undefined for non-numeric string", () => {
    expect(parseRetryAfterMs("not-a-number")).toBeUndefined();
  });

  test("parses HTTP-date to relative milliseconds", () => {
    const inOneHour = new Date(Date.now() + 3600_000).toUTCString();
    const result = parseRetryAfterMs(inOneHour);
    expect(result).toBeGreaterThan(3_599_000);
    expect(result).toBeLessThanOrEqual(3_600_000);
  });

  test("returns undefined for malformed HTTP-date", () => {
    expect(parseRetryAfterMs("Saturday")).toBeUndefined();
  });
});
