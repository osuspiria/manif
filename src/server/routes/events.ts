import { Hono, type Context } from 'hono';
import { RATE_LIMITS } from '../../config/app';
import {
  CreateEventRequestSchema,
  editRequestSchema,
  ReportRequestSchema,
  type ApiIssue,
} from '../../shared/schemas';
import { moderationMode, requestClientKey, type AppDeps } from '../deps';
import type { Env } from '../env';
import { d1Db } from '../repos/db';
import { eventsRepo, eventsWriteRepo } from '../repos/events-repo';
import type { GeoService } from '../services/geo-service';
import {
  createEvent,
  editEvent,
  getForOwner,
  reportEvent,
  type ServiceResult,
  type SubmissionDeps,
} from '../services/event-submission';
import { createEventsService } from '../services/events-service';
import { edgeCached } from './edge-cache';

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // ULID
const HOUR = 3600;
const DAY = 86400;

type C = Context<{ Bindings: Env }>;

function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): ApiIssue[] {
  return error.issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
    code: i.message,
  }));
}

async function readJson(c: C): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function respond<T>(c: C, result: ServiceResult<T>, okStatus: 200 | 201 = 200) {
  if (result.ok) return c.json(result.value, okStatus);
  return c.json({ error: result.error, issues: result.issues }, result.status);
}

export function eventsRoutes(geo: GeoService, deps: AppDeps) {
  const read = (env: Env) => createEventsService(eventsRepo(d1Db(env.DB)));
  const submission = (env: Env): SubmissionDeps => {
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
  const limited = async (c: C, action: string, limit: number) => {
    const key = await requestClientKey(c.req.raw, c.env, deps.clock());
    return !(await deps.rateLimiter(c.env).hit(`${action}:${key}`, limit, HOUR, deps.clock()));
  };
  const token = (c: C) => c.req.header('X-Edit-Token') ?? '';

  return (
    new Hono<{ Bindings: Env }>()
      // --- read ---------------------------------------------------------------
      .get('/events.geojson', (c) =>
        edgeCached(c, 60, async () => {
          const fc = await read(c.env).listVisible(deps.clock());
          return new Response(JSON.stringify(fc), {
            headers: { 'Content-Type': 'application/geo+json; charset=utf-8' },
          });
        }),
      )
      .get('/events/:id', async (c) => {
        const id = c.req.param('id');
        if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
        const event = await read(c.env).getPublic(id);
        if (!event) return c.json({ error: 'not_found' }, 404);
        c.header('Cache-Control', 'public, max-age=60');
        return c.json(event);
      })

      // --- create (SPEC §4.4) ---------------------------------------------------
      .post('/events', async (c) => {
        const parsed = CreateEventRequestSchema.safeParse(await readJson(c));
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        // Honeypot: a hidden field people never fill in.
        if (parsed.data.website) return c.json({ error: 'rejected' }, 400);
        if (await limited(c, 'create-event', RATE_LIMITS.createEvent)) {
          return c.json({ error: 'rate_limited' }, 429);
        }
        if (!(await deps.captcha(c.env).verify(parsed.data.turnstileToken))) {
          return c.json({ error: 'captcha_failed' }, 400);
        }
        const { turnstileToken, website, ...input } = parsed.data;
        void turnstileToken;
        void website;
        const origin = new URL(c.req.url).origin;
        return respond(c, await createEvent(input, origin, submission(c.env)), 201);
      })

      // --- owner (secret link; X-Edit-Token) ------------------------------------
      .get('/events/:id/edit', async (c) => {
        const id = c.req.param('id');
        if (!ID_RE.test(id) || !token(c)) return c.json({ error: 'not_found' }, 404);
        c.header('Cache-Control', 'no-store');
        return respond(c, await getForOwner(id, token(c), submission(c.env)));
      })
      .patch('/events/:id', async (c) => {
        const id = c.req.param('id');
        if (!ID_RE.test(id) || !token(c)) return c.json({ error: 'not_found' }, 404);
        const body = await readJson(c);
        const parsed = editRequestSchema(body).safeParse(body);
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        c.header('Cache-Control', 'no-store');
        return respond(c, await editEvent(id, token(c), parsed.data, submission(c.env)));
      })

      // --- report (SPEC §4.3, §4.5) ---------------------------------------------
      .post('/events/:id/report', async (c) => {
        const id = c.req.param('id');
        if (!ID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
        const parsed = ReportRequestSchema.safeParse(await readJson(c));
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        if (await limited(c, 'report', RATE_LIMITS.report)) {
          return c.json({ error: 'rate_limited' }, 429);
        }
        const key = await requestClientKey(c.req.raw, c.env, deps.clock());
        const first = await deps
          .rateLimiter(c.env)
          .hit(`report-once:${id}:${key}`, 1, DAY, deps.clock());
        return respond(c, await reportEvent(id, parsed.data, first, submission(c.env)), 201);
      })
  );
}
