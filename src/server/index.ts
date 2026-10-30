import { app } from './app';
import type { Env } from './env';
import { runScheduled } from './scheduled';

export default {
  fetch: app.fetch,
  /** Retention and the moderation digest (src/server/scheduled.ts). */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;
