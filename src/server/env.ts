/** Worker bindings (see wrangler.toml) and secrets (`wrangler secret put`, .dev.vars locally). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TILES: R2Bucket;
  /** Event posters (SPEC §4.7): '<eventId>/<ulid>' and '<eventId>/<ulid>/thumb'. */
  POSTERS: R2Bucket;
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
  /** 'on' (local dev and e2e only): emails go to a KV mailbox readable at /api/dev/mailbox from localhost. */
  DEV_MAILBOX?: string;
  /** Comma-separated addresses allowed to sign in to /admin (SPEC §6). */
  ADMIN_EMAILS?: string;
  /** Claude API key for the admin import (SPEC §6); without it the import is unavailable. */
  ANTHROPIC_API_KEY?: string;
  /** 'on' (e2e only): fixed answers instead of calling Claude (admin import) and Photon (place search). */
  FAKE_EXTERNAL?: string;
}
