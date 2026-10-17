/**
 * Fixed-window rate limiting. Keys are pseudonymous client keys (see
 * clientKey), never raw IPs. KV in production (approximate under concurrency,
 * which is fine for abuse prevention), in-memory for tests.
 */
export interface RateLimiter {
  /** Counts a hit; false when `limit` hits were already counted in the window. */
  hit(key: string, limit: number, windowSeconds: number, now: Date): Promise<boolean>;
}

function windowKey(key: string, windowSeconds: number, now: Date): string {
  return `${key}:${Math.floor(now.getTime() / 1000 / windowSeconds)}`;
}

export class KvRateLimiter implements RateLimiter {
  constructor(private readonly kv: KVNamespace) {}

  async hit(key: string, limit: number, windowSeconds: number, now: Date): Promise<boolean> {
    const k = windowKey(key, windowSeconds, now);
    const count = Number((await this.kv.get(k)) ?? '0');
    if (count >= limit) return false;
    // KV's minimum TTL is 60 s.
    await this.kv.put(k, String(count + 1), { expirationTtl: Math.max(60, windowSeconds) });
    return true;
  }
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();

  hit(key: string, limit: number, windowSeconds: number, now: Date): Promise<boolean> {
    const k = windowKey(key, windowSeconds, now);
    const count = this.counts.get(k) ?? 0;
    if (count >= limit) return Promise.resolve(false);
    this.counts.set(k, count + 1);
    return Promise.resolve(true);
  }
}
