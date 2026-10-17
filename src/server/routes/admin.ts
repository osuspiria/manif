/**
 * /api/admin/* (SPEC §6). Every route except login/session/logout needs a
 * session. The session cookie is the only cookie of the whole site: scoped to
 * /api/admin, HttpOnly, Secure, SameSite=Strict, set only after signing in.
 * Writes also need the X-Admin-Request header, which a cross-site form or
 * request cannot send without a CORS preflight (that we never allow).
 */
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ADMIN, RATE_LIMITS } from '../../config/app';
import { lisbonToday } from '../../shared/dates';
import {
  AdminEventActionSchema,
  AdminEventsQuerySchema,
  AdminLoginRequestSchema,
  AdminSessionRequestSchema,
  AdminSignatureActionSchema,
  AdminSignaturesQuerySchema,
  editRequestSchema,
} from '../../shared/schemas';
import { addressKey, moderationMode, requestClientKey, type AppDeps } from '../deps';
import type { Env } from '../env';
import { adminAuthRepo, adminEventsRepo, adminSignaturesRepo } from '../repos/admin-repo';
import { d1Db } from '../repos/db';
import { eventsRepo, eventsWriteRepo } from '../repos/events-repo';
import {
  endSession,
  parseAdminEmails,
  requestLogin,
  sessionEmail,
  startSession,
  type AdminAuthDeps,
} from '../services/admin-auth';
import {
  deleteSignature,
  eventDetail,
  exportContactsCsv,
  listEvents,
  listSignatures,
  moderateEvent,
  moderateSignature,
  type ModerationDeps,
} from '../services/admin-moderation';
import { moderatorEditEvent } from '../services/event-submission';
import type { GeoService } from '../services/geo-service';
import { readJson, zodIssues } from './http';

export const ADMIN_COOKIE = 'admin_session';
export const ADMIN_REQUEST_HEADER = 'X-Admin-Request';
const ADMIN_PATH = '/api/admin';
const HOUR = 3600;
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // ULID

type AdminEnv = { Bindings: Env; Variables: { adminEmail: string } };
type AC = Context<AdminEnv>;

export function adminRoutes(geo: GeoService, deps: AppDeps) {
  const auth = (env: Env): AdminAuthDeps => ({
    repo: adminAuthRepo(d1Db(env.DB)),
    mailer: deps.mailer(env),
    allowed: parseAdminEmails(env.ADMIN_EMAILS),
    allowEmail: async (email) =>
      deps
        .rateLimiter(env)
        .hit(
          `admin-mail:${await addressKey(email, env)}`,
          ADMIN.loginEmailsPerHour,
          HOUR,
          deps.clock(),
        ),
    now: deps.clock(),
  });
  const moderation = (env: Env): ModerationDeps => {
    const db = d1Db(env.DB);
    return {
      events: adminEventsRepo(db),
      read: eventsRepo(db),
      write: eventsWriteRepo(db),
      signatures: adminSignaturesRepo(db),
      now: deps.clock(),
    };
  };
  const submission = (env: Env) => {
    const db = d1Db(env.DB);
    return {
      read: eventsRepo(db),
      write: eventsWriteRepo(db),
      geo,
      mailer: deps.mailer(env),
      moderation: moderationMode(env),
      newId: deps.newId,
      now: deps.clock(),
    };
  };

  /** Never cache, never index anything under /api/admin. */
  const noStore: MiddlewareHandler<AdminEnv> = async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
  };

  /** CSRF: writes must carry the custom header (and, when sent, a same-origin Origin). */
  const csrf: MiddlewareHandler<AdminEnv> = async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('Origin');
      if (
        c.req.header(ADMIN_REQUEST_HEADER) !== '1' ||
        (origin && origin !== new URL(c.req.url).origin)
      ) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }
    await next();
  };

  const requireSession: MiddlewareHandler<AdminEnv> = async (c, next) => {
    const email = await sessionEmail(getCookie(c, ADMIN_COOKIE) ?? '', auth(c.env));
    if (!email) return c.json({ error: 'unauthorized' }, 401);
    c.set('adminEmail', email);
    await next();
  };

  const idParam = (c: AC) => {
    const id = c.req.param('id') ?? '';
    return ID_RE.test(id) ? id : null;
  };

  return (
    new Hono<AdminEnv>()
      .use('*', noStore, csrf)

      // --- sign in (SPEC §6: magic link to ADMIN_EMAILS) ---------------------------------
      .post('/login', async (c) => {
        const parsed = AdminLoginRequestSchema.safeParse(await readJson(c));
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        const key = await requestClientKey(c.req.raw, c.env, deps.clock());
        const ok = await deps
          .rateLimiter(c.env)
          .hit(`admin-login:${key}`, RATE_LIMITS.adminLogin, HOUR, deps.clock());
        if (!ok) return c.json({ error: 'rate_limited' }, 429);
        await requestLogin(parsed.data.email, new URL(c.req.url).origin, auth(c.env));
        // Same answer for every address.
        return c.json({ status: 'check_email' as const }, 202);
      })
      .post('/session', async (c) => {
        const parsed = AdminSessionRequestSchema.safeParse(await readJson(c));
        if (!parsed.success) return c.json({ error: 'invalid_link' }, 401);
        const session = await startSession(parsed.data.token, auth(c.env));
        if (!session) return c.json({ error: 'invalid_link' }, 401);
        setCookie(c, ADMIN_COOKIE, session.id, {
          path: ADMIN_PATH,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
          maxAge: session.maxAgeSeconds,
        });
        return c.json({ email: session.email });
      })
      .post('/logout', async (c) => {
        await endSession(getCookie(c, ADMIN_COOKIE) ?? '', auth(c.env));
        deleteCookie(c, ADMIN_COOKIE, { path: ADMIN_PATH, secure: true });
        return c.json({ ok: true });
      })
      .get('/me', requireSession, (c) => c.json({ email: c.get('adminEmail') }))

      // --- events ------------------------------------------------------------------------
      .get('/events', requireSession, async (c) => {
        const q = AdminEventsQuerySchema.parse(c.req.query());
        return c.json({ items: await listEvents(q, moderation(c.env)) });
      })
      .get('/events/:id', requireSession, async (c) => {
        const id = idParam(c);
        const detail = id ? await eventDetail(id, moderation(c.env)) : null;
        return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
      })
      .post('/events/:id/moderate', requireSession, async (c) => {
        const id = idParam(c);
        const parsed = AdminEventActionSchema.safeParse(await readJson(c));
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        const item = id ? await moderateEvent(id, parsed.data.action, moderation(c.env)) : null;
        return item ? c.json(item) : c.json({ error: 'not_found' }, 404);
      })
      .patch('/events/:id', requireSession, async (c) => {
        const id = idParam(c);
        if (!id) return c.json({ error: 'not_found' }, 404);
        const body = await readJson(c);
        const parsed = editRequestSchema(body).safeParse(body);
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        const result = await moderatorEditEvent(id, parsed.data, submission(c.env));
        if (!result.ok) {
          return c.json({ error: result.error, issues: result.issues }, result.status);
        }
        const detail = await eventDetail(id, moderation(c.env));
        return c.json(detail);
      })

      // --- signatures --------------------------------------------------------------------
      .get('/signatures', requireSession, async (c) => {
        const q = AdminSignaturesQuerySchema.parse(c.req.query());
        return c.json(await listSignatures(q, moderation(c.env)));
      })
      .get('/signatures/export.csv', requireSession, async (c) => {
        const csv = await exportContactsCsv(moderation(c.env));
        const day = lisbonToday(deps.clock());
        return c.body(csv, 200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="contactos-${day}.csv"`,
        });
      })
      .post('/signatures/:id/moderate', requireSession, async (c) => {
        const id = idParam(c);
        const parsed = AdminSignatureActionSchema.safeParse(await readJson(c));
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        if (!id) return c.json({ error: 'not_found' }, 404);
        const result = await moderateSignature(id, parsed.data.action, moderation(c.env));
        return result.ok ? c.json(result.value) : c.json({ error: result.error }, result.status);
      })
      .delete('/signatures/:id', requireSession, async (c) => {
        const id = idParam(c);
        const done = id ? await deleteSignature(id, moderation(c.env)) : false;
        return done ? c.json({ deleted: true }) : c.json({ error: 'not_found' }, 404);
      })
  );
}
