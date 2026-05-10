export interface PatternMetadata {
  /** Discriminant action type, e.g. "invoke_agent", "stop_agent", "api_call" */
  readonly action: string;
  /** Action-specific payload */
  readonly payload?: Record<string, unknown>;
}

export interface PatternMatch {
  readonly pattern: string;
  readonly metadata: PatternMetadata;
}

export interface PatternRegistryPort {
  register(pattern: string, metadata: PatternMetadata): void;
  match(text: string): PatternMatch | undefined;
}
