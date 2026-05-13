import type { PlayerData } from "../../domain/types/player-data";

const ENTITY_DATA_MARKER = "has the following entity data:";
const NO_ENTITY_FOUND_MARKER = "No entity was found";
const EXCLUDED_ROOT_KEYS = new Set(["attributes", "recipeBook"]);

export type PlayerDataFeedback =
  | { readonly kind: "data"; readonly data: PlayerData }
  | { readonly kind: "offline" }
  | { readonly kind: "unrelated" };

export class PlayerDataParseError extends Error {
  readonly name = "PlayerDataParseError";
}

export function parsePlayerDataFeedbackLine(line: string, playerName: string): PlayerDataFeedback {
  if (line.includes(NO_ENTITY_FOUND_MARKER)) {
    return { kind: "offline" };
  }

  const markerIndex = line.indexOf(ENTITY_DATA_MARKER);
  if (markerIndex < 0 || !line.includes(`${playerName} ${ENTITY_DATA_MARKER}`)) {
    return { kind: "unrelated" };
  }

  const snbt = line.slice(markerIndex + ENTITY_DATA_MARKER.length).trim();
  return { kind: "data", data: parsePlayerDataSnbt(snbt) };
}

export function parsePlayerDataSnbt(source: string): PlayerData {
  const parser = new SnbtParser(source);
  const value = parser.parse();
  if (!isRecord(value)) {
    throw new PlayerDataParseError("Player data root must be a compound.");
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !EXCLUDED_ROOT_KEYS.has(key)),
  );
}

class SnbtParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (!this.isAtEnd()) {
      throw new PlayerDataParseError(`Unexpected trailing SNBT at offset ${this.index}.`);
    }
    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    if (this.isAtEnd()) {
      throw new PlayerDataParseError("Unexpected end of SNBT input.");
    }

    const char = this.source[this.index];
    if (char === "{") return this.parseCompound();
    if (char === "[") return this.parseList();
    if (char === '"' || char === "'") return this.parseQuotedString();
    return this.parseBareToken();
  }

  private parseCompound(): Record<string, unknown> {
    this.expect("{");
    const result: Record<string, unknown> = {};
    this.skipWhitespace();

    if (this.peek() === "}") {
      this.index += 1;
      return result;
    }

    while (!this.isAtEnd()) {
      const key = this.parseKey();
      this.skipWhitespace();
      this.expect(":");
      result[key] = this.parseValue();
      this.skipWhitespace();

      const next = this.peek();
      if (next === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }
      if (next === "}") {
        this.index += 1;
        return result;
      }
      throw new PlayerDataParseError(`Expected ',' or '}' at offset ${this.index}.`);
    }

    throw new PlayerDataParseError("Unterminated SNBT compound.");
  }

  private parseList(): unknown[] {
    this.expect("[");
    this.skipWhitespace();

    if (this.isTypedArrayPrefix()) {
      this.index += 2;
      this.skipWhitespace();
    }

    if (this.peek() === "]") {
      this.index += 1;
      return [];
    }

    const items: unknown[] = [];
    while (!this.isAtEnd()) {
      items.push(this.parseValue());
      this.skipWhitespace();

      const next = this.peek();
      if (next === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }
      if (next === "]") {
        this.index += 1;
        return items;
      }
      throw new PlayerDataParseError(`Expected ',' or ']' at offset ${this.index}.`);
    }

    throw new PlayerDataParseError("Unterminated SNBT list.");
  }

  private parseKey(): string {
    this.skipWhitespace();
    const next = this.peek();
    if (next === '"' || next === "'") return this.parseQuotedString();

    const start = this.index;
    while (!this.isAtEnd() && this.source[this.index] !== ":") {
      this.index += 1;
    }

    const key = this.source.slice(start, this.index).trim();
    if (key.length === 0) {
      throw new PlayerDataParseError(`Empty SNBT key at offset ${start}.`);
    }
    return key;
  }

  private parseQuotedString(): string {
    const quote = this.source[this.index];
    this.index += 1;
    let result = "";

    while (!this.isAtEnd()) {
      const char = this.source[this.index];
      this.index += 1;

      if (char === quote) return result;
      if (char === "\\") {
        if (this.isAtEnd()) {
          throw new PlayerDataParseError("Unterminated SNBT string escape.");
        }
        result += parseEscapedCharacter(this.source[this.index]!);
        this.index += 1;
      } else {
        result += char;
      }
    }

    throw new PlayerDataParseError("Unterminated SNBT string.");
  }

  private parseBareToken(): string {
    const start = this.index;
    while (!this.isAtEnd()) {
      const char = this.source[this.index];
      if (char === "," || char === "]" || char === "}") break;
      this.index += 1;
    }

    const token = this.source.slice(start, this.index).trim();
    if (token.length === 0) {
      throw new PlayerDataParseError(`Empty SNBT value at offset ${start}.`);
    }
    return token;
  }

  private isTypedArrayPrefix(): boolean {
    if (this.index + 1 >= this.source.length) return false;
    const type = this.source[this.index];
    return (type === "B" || type === "I" || type === "L") && this.source[this.index + 1] === ";";
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.source[this.index]!)) {
      this.index += 1;
    }
  }

  private expect(expected: string): void {
    if (this.source[this.index] !== expected) {
      throw new PlayerDataParseError(`Expected '${expected}' at offset ${this.index}.`);
    }
    this.index += 1;
  }

  private peek(): string | undefined {
    return this.source[this.index];
  }

  private isAtEnd(): boolean {
    return this.index >= this.source.length;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEscapedCharacter(char: string): string {
  switch (char) {
    case "\\": return "\\";
    case '"': return '"';
    case "'": return "'";
    case "n": return "\n";
    case "r": return "\r";
    case "t": return "\t";
    case "b": return "\b";
    case "f": return "\f";
    default: return `\\${char}`;
  }
}
