import type {
  DerivedIndex,
  SchemaKind,
  SearchHit,
} from "../domain/types/mcdoc.types";
import { tokenize } from "./indexer";

export interface SearchInput {
  readonly query: string;
  readonly kind?: SchemaKind;
  readonly package?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ScoreEntry {
  score: number;
  matchedOn: Set<"path" | "field" | "desc">;
}

/** Score-based ranker over a {@link DerivedIndex}. Pure. */
export function search(index: DerivedIndex, input: SearchInput): SearchHit[] {
  const limit = clampLimit(input.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const tokens = tokenize(input.query);
  if (tokens.length === 0) return [];

  const scores = new Map<string, ScoreEntry>();
  const queryLower = input.query.toLowerCase();

  for (const tok of tokens) {
    // Path / name tokens.
    const namedPaths = index.nameIndex[tok];
    if (namedPaths) {
      for (const p of namedPaths) {
        addScore(scores, p, scoreNameMatch(p, tok, queryLower), "path");
      }
    }

    // Field key exact + description.
    const fieldHits = index.fieldIndex[tok];
    if (fieldHits) {
      for (const fh of fieldHits) {
        addScore(scores, fh.path, 30, "field");
      }
    }

    const descHits = index.descIndex[tok];
    if (descHits) {
      for (const p of descHits) {
        addScore(scores, p, 5, "desc");
      }
    }
  }

  // Field-key substring match (token-by-token already covers exact; this catches partial keys).
  for (const [fieldKey, hits] of Object.entries(index.fieldIndex)) {
    const lowerKey = fieldKey.toLowerCase();
    if (lowerKey === queryLower) {
      for (const h of hits) addScore(scores, h.path, 30, "field");
    } else if (lowerKey.includes(queryLower) && queryLower.length >= 3) {
      for (const h of hits) addScore(scores, h.path, 10, "field");
    }
  }

  // Apply filters and materialize.
  const results: SearchHit[] = [];
  for (const [path, entry] of scores) {
    if (input.kind && index.kinds[path] !== input.kind) continue;
    if (input.package && !path.startsWith(input.package)) continue;

    results.push({
      path,
      kind: index.kinds[path] ?? "unknown",
      score: entry.score,
      matchedOn: [...entry.matchedOn].sort(),
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.localeCompare(b.path);
  });

  return results.slice(0, limit);
}

function scoreNameMatch(path: string, token: string, fullQueryLower: string): number {
  const lower = path.toLowerCase();
  const segments = lower.split("::").filter((s) => s.length > 0);
  const last = segments[segments.length - 1] ?? "";

  if (last === token) return 100;
  if (last === fullQueryLower) return 100;
  if (last.startsWith(token)) return 50;
  if (segments.includes(token)) return 60;
  if (lower.includes(token)) return 20;
  return 5;
}

function addScore(
  scores: Map<string, ScoreEntry>,
  path: string,
  delta: number,
  matched: "path" | "field" | "desc",
): void {
  const existing = scores.get(path);
  if (existing) {
    existing.score += delta;
    existing.matchedOn.add(matched);
  } else {
    scores.set(path, { score: delta, matchedOn: new Set([matched]) });
  }
}

export function clampLimit(value: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (value === undefined || !Number.isFinite(value)) return defaultLimit;
  if (value < 1) return defaultLimit;
  return Math.min(Math.floor(value), maxLimit);
}
