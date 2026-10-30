/**
 * Operational state (docs/decisions.md #82) in KV: when the daily job last
 * finished, and how many imports with Claude ran per day. Counts and
 * timestamps only, never personal data. Shares the RATE_LIMIT namespace.
 */

export interface OpsStore {
  /** ISO instant the retention job last finished without error, or null. */
  lastRetentionAt(): Promise<string | null>;
  setLastRetentionAt(iso: string): Promise<void>;
  /** Adds one to the day's count (Lisbon date). Approximate: KV has no atomic increment. */
  countExtraction(date: string): Promise<void>;
  extractions(date: string): Promise<number>;
}

const LAST_RETENTION = 'ops:retention:last-ok';
const extractKey = (date: string) => `ops:extractions:${date}`;
/** Kept a little longer than the activity table shows. */
const COUNTER_TTL_SECONDS = 40 * 86400;

export function kvOpsStore(kv: KVNamespace): OpsStore {
  return {
    lastRetentionAt: () => kv.get(LAST_RETENTION),
    async setLastRetentionAt(iso) {
      await kv.put(LAST_RETENTION, iso);
    },
    async countExtraction(date) {
      const n = Number((await kv.get(extractKey(date))) ?? '0');
      await kv.put(extractKey(date), String(n + 1), { expirationTtl: COUNTER_TTL_SECONDS });
    },
    async extractions(date) {
      return Number((await kv.get(extractKey(date))) ?? '0');
    },
  };
}
