/** Worker bindings (see wrangler.toml). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TILES: R2Bucket;
  MODERATION_MODE: string;
  /** 'on' enables the edge Cache API for public JSON; tests set 'off'. */
  EDGE_CACHE?: string;
}
