import type {
  PatternMetadata,
  PatternMatch,
  PatternRegistryPort,
} from "../../domain/ports/pattern-registry.port";

export class InMemoryPatternRegistryAdapter implements PatternRegistryPort {
  private readonly patterns = new Map<string, PatternMetadata>();

  register(pattern: string, metadata: PatternMetadata): void {
    this.patterns.set(pattern, metadata);
  }

  match(text: string): PatternMatch | undefined {
    for (const [pattern, metadata] of this.patterns) {
      if (hasWordBoundaryMatch(text, pattern)) {
        return { pattern, metadata };
      }
    }
    return undefined;
  }
}

function hasWordBoundaryMatch(text: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?=[^a-zA-Z0-9]|$)`);
  return re.test(text);
}
