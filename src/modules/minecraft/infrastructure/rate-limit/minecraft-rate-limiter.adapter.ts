import type {
  MinecraftRateLimiterPort,
  RateLimitResult,
} from "../../domain/ports/minecraft-rate-limiter.port";

export class MinecraftRateLimiterAdapter implements MinecraftRateLimiterPort {
  private readonly timestamps = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  isAllowed(playerName: string): RateLimitResult {
    const now = Date.now();

    this.evictStale(now);

    const last = this.timestamps.get(playerName);

    if (last !== undefined && now - last < this.cooldownMs) {
      return {
        allowed: false,
        retryAfterMs: this.cooldownMs - (now - last),
      };
    }

    this.timestamps.set(playerName, now);
    return { allowed: true };
  }

  private evictStale(now: number): void {
    for (const [name, timestamp] of this.timestamps) {
      if (now - timestamp >= this.cooldownMs) {
        this.timestamps.delete(name);
      }
    }
  }
}
