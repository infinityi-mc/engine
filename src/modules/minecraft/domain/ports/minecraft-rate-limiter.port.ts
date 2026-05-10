export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs?: number;
}

export interface MinecraftRateLimiterPort {
  /** Check if a player is allowed to make a request. Updates the timestamp if allowed. */
  isAllowed(playerName: string): RateLimitResult;
}
