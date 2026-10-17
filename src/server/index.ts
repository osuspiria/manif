import { app } from './app';
import type { Env } from './env';
import { d1Db } from './repos/db';
import { retentionRepo } from './repos/admin-repo';
import { systemClock } from './clock';
import { runRetention } from './services/retention';

export default {
  fetch: app.fetch,
  /** Daily retention job (SPEC §7; wrangler.toml [triggers]). Logs counts only. */
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runRetention(retentionRepo(d1Db(env.DB)), systemClock()).then((r) => {
        console.log(`retention: ${JSON.stringify(r)}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
