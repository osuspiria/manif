import { app } from './app';
import type { Env } from './env';
import { d1Db } from './repos/db';
import { retentionRepo } from './repos/admin-repo';
import { r2PosterStore } from './repos/poster-store';
import { systemClock } from './clock';
import { CAMPAIGN_END } from '../config/app';
import { runRetention } from './services/retention';

export default {
  fetch: app.fetch,
  /** Daily retention job (SPEC §7; wrangler.toml [triggers]). Logs counts only. */
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runRetention(
        retentionRepo(d1Db(env.DB)),
        systemClock(),
        CAMPAIGN_END,
        r2PosterStore(env.POSTERS),
      ).then((r) => {
        console.log(`retention: ${JSON.stringify(r)}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
