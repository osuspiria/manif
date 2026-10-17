/** Worker bindings (see wrangler.toml). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MODERATION_MODE: string;
}
