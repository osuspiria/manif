/**
 * Local development and e2e helpers. Answer 404 unless DEV_MAILBOX=on AND the
 * request is for localhost: through Cloudflare's edge the host is always the
 * public domain, so a misconfigured variable alone exposes nothing.
 */
import { Hono } from 'hono';
import { devMailboxEnabled } from '../deps';
import type { Env } from '../env';
import { KvDevMailbox } from '../mailer';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function devRoutes() {
  return new Hono<{ Bindings: Env }>().get('/mailbox', async (c) => {
    if (!devMailboxEnabled(c.env) || !LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      return c.json({ error: 'not_found' }, 404);
    }
    const to = c.req.query('to') ?? '';
    c.header('Cache-Control', 'no-store');
    return c.json({ messages: await new KvDevMailbox(c.env.RATE_LIMIT).read(to) });
  });
}
