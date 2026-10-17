/** Worker bindings (see wrangler.toml) and secrets (`wrangler secret put`, .dev.vars locally). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TILES: R2Bucket;
  /** Rate-limit counters (hashed client keys only). */
  RATE_LIMIT: KVNamespace;
  MODERATION_MODE: string;
  /** 'on' enables the edge Cache API for public JSON; tests and local dev set 'off'. */
  EDGE_CACHE?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Server secret from which the daily IP-hash salt is derived. */
  RATE_LIMIT_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}
