/**
 * Guarantees that public API responses never contain personal data
 * (CLAUDE.md › Privacidade). Every public route must be listed in
 * src/server/public-routes.ts with samples; this test calls them all.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, createApp } from '../../src/server/app';
import { FakeMailer } from '../../src/server/mailer';
import { PUBLIC_ROUTES } from '../../src/server/public-routes';
import { FakeCaptcha } from '../../src/server/security/captcha';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import { IDS, insertEvent, insertSignature, resetDb, SENTINELS } from './fixtures';

const fixedApp = createApp({
  clock: () => new Date('2026-11-11T10:00:00Z'),
  captcha: () => new FakeCaptcha(true),
  mailer: () => new FakeMailer(),
  rateLimiter: () => new MemoryRateLimiter(),
  placeSearch: () => ({
    search: () => Promise.resolve([{ label: 'Rossio, Lisboa', lat: 38.71, lng: -9.14 }]),
  }),
});

/** Keys that must never appear in a public response, at any depth. */
const FORBIDDEN_KEYS = new Set(
  [
    'email',
    'contact_email',
    'contactEmail',
    'phone',
    'contact_name',
    'contactName',
    'edit_token_hash',
    'editTokenHash',
    'confirm_token_hash',
    'confirmTokenHash',
    'ip',
    'ip_hash',
    'ipHash',
  ].map((k) => k.toLowerCase()),
);

const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
// Portuguese phone numbers (mobile 9x, landline 2x), with optional +351 / spaces.
const PHONE_RE = /(?:\+351[\s-]?)?\b[29]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/;

function findLeaks(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') {
    const leaks: string[] = [];
    if (EMAIL_RE.test(value)) leaks.push(`${path}: looks like an email`);
    if (PHONE_RE.test(value)) leaks.push(`${path}: looks like a phone number`);
    return leaks;
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findLeaks(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEYS.has(k.toLowerCase()) ? [`${path}.${k}: forbidden key`] : []),
      ...findLeaks(v, `${path}.${k}`),
    ]);
  }
  return [];
}

describe('leak detector self-check', () => {
  it('flags forbidden keys, emails and phone numbers', () => {
    expect(findLeaks({ a: [{ Email: 'x' }] })).toHaveLength(1);
    expect(findLeaks({ note: 'escreve para ana@exemplo.pt' })).toHaveLength(1);
    expect(findLeaks({ note: 'liga 912 345 678' })).toHaveLength(1);
    expect(findLeaks({ note: '+351 213456789' })).toHaveLength(1);
    expect(findLeaks({ municipality: 'Porto', code: '1312', lat: 41.1496 })).toEqual([]);
  });
});

describe('public API privacy', () => {
  it('every public route registered in Hono is listed in PUBLIC_ROUTES', () => {
    const registered = new Set(
      app.routes
        .filter(
          (r) =>
            r.method !== 'ALL' &&
            !r.path.startsWith('/api/admin') &&
            !r.path.startsWith('/api/dev'),
        )
        .map((r) => `${r.method} ${r.path}`),
    );
    const listed = new Set(PUBLIC_ROUTES.map((r) => `${r.method} ${r.route}`));
    expect([...registered].filter((r) => !listed.has(r))).toEqual([]);
    expect([...listed].filter((r) => !registered.has(r))).toEqual([]);
  });

  it('every listed route has at least one sample', () => {
    for (const r of PUBLIC_ROUTES) expect(r.samples.length, r.route).toBeGreaterThan(0);
  });

  const samples = PUBLIC_ROUTES.flatMap((r) =>
    r.samples.map((s) => ({
      name: `${r.method} ${s.url}`,
      method: r.method,
      init: s.init,
      url: s.url.replace('{eventId}', IDS.a).replace('{hiddenEventId}', IDS.c),
    })),
  );

  beforeEach(async () => {
    await resetDb();
    // Fixtures carry a contact email and an edit-token hash that must never leak.
    await insertEvent({
      id: IDS.a,
      occurrences: [{ localDate: '2026-11-18', startTime: '18:00', note: 'Concentração às 18h' }],
    });
    await insertEvent({
      id: IDS.c,
      status: 'pending',
      occurrences: [{ localDate: '2026-11-18', startTime: '18:00' }],
    });
    // Signatures in every state, all carrying a sentinel email, phone and contact name.
    await insertSignature({ id: IDS.a });
    await insertSignature({ id: IDS.b, pseudonym: 'Pseudónimo Público' });
    await insertSignature({ id: IDS.c, isPublic: false });
    await insertSignature({ id: IDS.d, status: 'unconfirmed' });
    await insertSignature({ id: IDS.e, kind: 'organization', status: 'approved' });
    await insertSignature({ id: IDS.f, kind: 'organization', status: 'confirmed' });
  });

  it.each(samples)('$name leaks no personal data and sets no cookie', async (s) => {
    const res = await fixedApp.request(
      `http://localhost${s.url}`,
      { method: s.method, ...s.init },
      env,
    );
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const contentType = res.headers.get('Content-Type') ?? '';
    // Binary responses (tiles, glyphs) carry no personal data; only scan text.
    const body = /json|html|text/.test(contentType) ? await res.text() : '';
    for (const secret of Object.values(SENTINELS)) expect(body).not.toContain(secret);
    if (res.headers.get('Content-Type')?.includes('json')) {
      expect(findLeaks(JSON.parse(body))).toEqual([]);
    } else {
      expect(EMAIL_RE.test(body), 'email-like text in non-JSON body').toBe(false);
    }
  });
});

describe('dev mailbox', () => {
  const url = (host: string) => `http://${host}/api/dev/mailbox?to=ana@exemplo.pt`;

  it('is not reachable unless DEV_MAILBOX=on', async () => {
    const res = await app.request(url('localhost'), {}, { ...env, DEV_MAILBOX: undefined });
    expect(res.status).toBe(404);
  });

  it('is not reachable through a public host name, even with DEV_MAILBOX=on', async () => {
    const res = await app.request(url('exemplo.pt'), {}, { ...env, DEV_MAILBOX: 'on' });
    expect(res.status).toBe(404);
  });

  it('answers on localhost with DEV_MAILBOX=on', async () => {
    const res = await app.request(url('localhost'), {}, { ...env, DEV_MAILBOX: 'on' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
  });
});
