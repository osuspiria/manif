/**
 * Cron Triggers (wrangler.toml [triggers], CRONS in src/config/app.ts):
 * - daily: retention (SPEC §7), with an email to the admins when it fails;
 * - digest: morning moderation digest to ADMIN_EMAILS (docs/decisions.md #82).
 * Logs counts and error names only.
 */
import { CAMPAIGN_END, CRONS } from '../config/app';
import { defaultDeps, type AppDeps } from './deps';
import type { Env } from './env';
import { adminEventsRepo, retentionRepo } from './repos/admin-repo';
import { d1Db } from './repos/db';
import { parseAdminEmails } from './services/admin-auth';
import { runDailyJob, sendDigest, type OpsDeps } from './services/operations';
import { runRetention } from './services/retention';

/**
 * The site origin the static pages were built for (PUBLIC_SITE_URL), read from
 * the home page's canonical link: a cron has no request to take it from, and
 * production URLs stay out of the code (docs/decisions.md #75).
 */
export async function siteOrigin(env: Env): Promise<string | null> {
  try {
    const res = await env.ASSETS.fetch(new Request('https://assets.invalid/'));
    const html = await res.text();
    const href = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html)?.[1];
    return href ? new URL(href).origin : null;
  } catch {
    return null;
  }
}

export async function runScheduled(
  cron: string,
  env: Env,
  deps: Pick<AppDeps, 'clock' | 'mailer' | 'posters' | 'ops'> = defaultDeps,
): Promise<void> {
  const now = deps.clock();
  const db = d1Db(env.DB);
  const ops: OpsDeps = {
    events: adminEventsRepo(db),
    ops: deps.ops(env),
    mailer: deps.mailer(env),
    admins: [...parseAdminEmails(env.ADMIN_EMAILS)],
    origin: await siteOrigin(env),
    now,
  };
  if (cron === CRONS.digest) {
    const sent = await sendDigest(ops);
    console.log(`digest: ${sent ? 'sent' : 'nothing to moderate'}`);
    return;
  }
  const result = await runDailyJob(
    () => runRetention(retentionRepo(db), now, CAMPAIGN_END, deps.posters(env)),
    ops,
  );
  if (result) console.log(`retention: ${JSON.stringify(result)}`);
}
