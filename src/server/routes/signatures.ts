import { Hono } from 'hono';
import { RATE_LIMITS } from '../../config/app';
import { SIGNATURE_LIMITS } from '../../config/signatures';
import { pt } from '../../i18n/pt';
import {
  PublicSignaturesQuerySchema,
  signatureFormToBody,
  signatureRequestSchema,
  WithdrawRequestSchema,
  type ApiIssue,
} from '../../shared/schemas';
import { addressKey, requestClientKey, type AppDeps } from '../deps';
import type { Env } from '../env';
import { signatureErrorPage } from '../html/signature-error-page';
import { d1Db } from '../repos/db';
import { signaturesRepo } from '../repos/signatures-repo';
import {
  confirm,
  listPublic,
  sign,
  stats,
  withdraw,
  type SignatureDeps,
} from '../services/signatures';
import { edgeCached } from './edge-cache';
import { readJson, zodIssues, type C } from './http';

const HOUR = 3600;
const DAY = 86400;
const TOKEN_RE = /^[\w-]{20,100}$/;

/** Static pages the no-JavaScript flow lands on (src/pages/apoio/). */
export const SUPPORT_PAGES = {
  checkEmail: '/apoio/confirma-email/',
  thanks: '/apoio/obrigado/',
  invalidLink: '/apoio/link-invalido/',
} as const;

async function readForm(c: C): Promise<Record<string, unknown> | null> {
  try {
    return signatureFormToBody(await c.req.parseBody());
  } catch {
    return null;
  }
}

export function signaturesRoutes(deps: AppDeps) {
  const limited = async (c: C, action: string, limit: number) => {
    const key = await requestClientKey(c.req.raw, c.env, deps.clock());
    return !(await deps.rateLimiter(c.env).hit(`${action}:${key}`, limit, HOUR, deps.clock()));
  };
  const service = (env: Env): SignatureDeps => ({
    repo: signaturesRepo(d1Db(env.DB)),
    mailer: deps.mailer(env),
    allowEmail: async (email) =>
      deps
        .rateLimiter(env)
        .hit(
          `sig-mail:${await addressKey(email, env)}`,
          SIGNATURE_LIMITS.emailsPerAddressPerDay,
          DAY,
          deps.clock(),
        ),
    newId: deps.newId,
    now: deps.clock(),
  });

  return (
    new Hono<{ Bindings: Env }>()
      // --- sign (SPEC §5.3): JSON from the enhanced form, or a plain HTML form POST --
      .post('/signatures', async (c) => {
        const isJson = (c.req.header('Content-Type') ?? '').includes('application/json');
        const wantsJson = isJson || (c.req.header('Accept') ?? '').includes('application/json');
        const body = isJson ? await readJson(c) : await readForm(c);
        const kind =
          body && typeof body === 'object' && 'kind' in body ? String(body.kind) : 'individual';
        const fail = (status: 400 | 429, error: string, message: string, issues?: ApiIssue[]) =>
          wantsJson
            ? c.json({ error, issues }, status)
            : c.html(signatureErrorPage({ message, issues, kind }), status);

        const parsed = signatureRequestSchema(body).safeParse(body);
        if (!parsed.success) {
          return fail(400, 'invalid', pt.support.errors.fix, zodIssues(parsed.error));
        }
        // Honeypot: a hidden field people never fill in.
        if (parsed.data.website) return fail(400, 'rejected', pt.support.errors.rejected);
        if (await limited(c, 'sign', RATE_LIMITS.sign)) {
          return fail(429, 'rate_limited', pt.support.errors.rate_limited);
        }
        const token = parsed.data.turnstileToken;
        // No token: the form was sent without JavaScript (Turnstile needs it).
        if (!token) return fail(400, 'captcha_failed', pt.support.errors.captcha_missing);
        if (!(await deps.captcha(c.env).verify(token))) {
          return fail(400, 'captcha_failed', pt.support.errors.captcha_failed);
        }

        await sign(parsed.data, new URL(c.req.url).origin, service(c.env));
        c.header('Cache-Control', 'no-store');
        return wantsJson
          ? c.json({ status: 'check_email' as const }, 202)
          : c.redirect(SUPPORT_PAGES.checkEmail, 303);
      })

      // --- confirmation link from the email ------------------------------------------
      .get('/signatures/confirm', async (c) => {
        c.header('Cache-Control', 'no-store');
        c.header('Referrer-Policy', 'no-referrer');
        const token = c.req.query('token') ?? '';
        if (!TOKEN_RE.test(token)) return c.redirect(SUPPORT_PAGES.invalidLink, 303);
        const result = await confirm(token, service(c.env));
        return c.redirect(result.ok ? SUPPORT_PAGES.thanks : SUPPORT_PAGES.invalidLink, 303);
      })

      // --- withdraw (deletes the record) ------------------------------------------------
      .post('/signatures/withdraw', async (c) => {
        c.header('Cache-Control', 'no-store');
        const parsed = WithdrawRequestSchema.safeParse(await readJson(c));
        if (!parsed.success) return c.json({ error: 'not_found' }, 404);
        if (await limited(c, 'withdraw', RATE_LIMITS.sign)) {
          return c.json({ error: 'rate_limited' }, 429);
        }
        return (await withdraw(parsed.data.token, service(c.env)))
          ? c.json({ withdrawn: true })
          : c.json({ error: 'not_found' }, 404);
      })

      // --- public counters and list ------------------------------------------------------
      .get('/signatures/stats', (c) =>
        edgeCached(c, 30, async () => Response.json(await stats(service(c.env)))),
      )
      .get('/signatures/public', (c) => {
        const parsed = PublicSignaturesQuerySchema.safeParse(c.req.query());
        if (!parsed.success) {
          return c.json({ error: 'invalid', issues: zodIssues(parsed.error) }, 400);
        }
        return edgeCached(c, 30, async () =>
          Response.json(await listPublic(parsed.data, service(c.env))),
        );
      })
  );
}
