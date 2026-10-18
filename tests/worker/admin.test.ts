import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { app as realApp, createApp } from '../../src/server/app';
import { FakeMailer } from '../../src/server/mailer';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import { FakeCaptcha } from '../../src/server/security/captcha';
import {
  AdminEventDetailSchema,
  AdminEventListSchema,
  AdminSignatureListSchema,
  PublicEventCollectionSchema,
  PublicSignaturesSchema,
} from '../../src/shared/schemas';
import { csvCell } from '../../src/server/services/admin-moderation';
import { IDS, insertEvent, insertReport, insertSignature, resetDb } from './fixtures';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');
let clockNow = NOW;
let mailer: FakeMailer;
let limiter: MemoryRateLimiter;

const ADMIN_EMAIL = 'admin@exemplo.pt';
const adminEnv = { ...env, ADMIN_EMAILS: `${ADMIN_EMAIL}, outra.admin@exemplo.pt` };

const app = () =>
  createApp({
    clock: () => clockNow,
    captcha: () => new FakeCaptcha(true),
    mailer: () => mailer,
    rateLimiter: () => limiter,
    features: { signatures: true, privacyPage: true, eventContactEmail: true },
  });

interface Req {
  method?: string;
  json?: unknown;
  cookie?: string;
  csrf?: boolean;
  origin?: string;
  env?: typeof adminEnv;
  ip?: string;
}

function call(path: string, r: Req = {}) {
  const headers: Record<string, string> = {};
  if (r.json !== undefined) headers['Content-Type'] = 'application/json';
  if (r.csrf !== false) headers['X-Admin-Request'] = '1';
  if (r.cookie) headers.Cookie = `admin_session=${r.cookie}`;
  if (r.origin) headers.Origin = r.origin;
  if (r.ip) headers['CF-Connecting-IP'] = r.ip;
  return app().request(
    `http://localhost${path}`,
    {
      method: r.method ?? (r.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: r.json !== undefined ? JSON.stringify(r.json) : undefined,
    },
    r.env ?? adminEnv,
  );
}

function tokenFromMail(): string {
  return /\/admin\/entrar\/#t=([\w-]+)/.exec(mailer.last()?.text ?? '')?.[1] ?? '';
}

async function signIn(): Promise<string> {
  expect((await call('/api/admin/login', { json: { email: ADMIN_EMAIL } })).status).toBe(202);
  const res = await call('/api/admin/session', { json: { token: tokenFromMail() } });
  expect(res.status).toBe(200);
  const cookie = /admin_session=([^;]+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1];
  expect(cookie).toBeTruthy();
  return cookie ?? '';
}

beforeEach(async () => {
  await resetDb();
  mailer = new FakeMailer();
  limiter = new MemoryRateLimiter();
  clockNow = NOW;
});

describe('admin sign-in (magic link)', () => {
  it('emails a single-use link to allowed addresses only, answering the same way', async () => {
    const res = await call('/api/admin/login', { json: { email: ' Admin@Exemplo.pt ' } });
    expect(res.status).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last()?.to).toBe(ADMIN_EMAIL);
    expect(mailer.last()?.text).toContain('http://localhost/admin/entrar/#t=');

    const other = await call('/api/admin/login', { json: { email: 'intruso@exemplo.pt' } });
    expect(other.status).toBe(202);
    expect(await other.json()).toEqual(await res.clone().json());
    expect(mailer.sent).toHaveLength(1);
    // Only the hash is stored.
    const row = await env.DB.prepare('SELECT token_hash FROM admin_login_tokens').first<{
      token_hash: string;
    }>();
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.token_hash).not.toBe(tokenFromMail());
  });

  it('opening the link starts a session with a strict, scoped cookie', async () => {
    await call('/api/admin/login', { json: { email: ADMIN_EMAIL } });
    const res = await call('/api/admin/session', { json: { token: tokenFromMail() } });
    expect(await res.json()).toEqual({ email: ADMIN_EMAIL });
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^admin_session=[\w-]{43};/);
    expect(cookie).toContain('Path=/api/admin');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=86400');
  });

  it('a link works once, and only for 15 minutes', async () => {
    await call('/api/admin/login', { json: { email: ADMIN_EMAIL } });
    const token = tokenFromMail();
    expect((await call('/api/admin/session', { json: { token } })).status).toBe(200);
    expect((await call('/api/admin/session', { json: { token } })).status).toBe(401);

    await call('/api/admin/login', { json: { email: ADMIN_EMAIL } });
    clockNow = new Date('2026-11-11T10:15:00Z');
    const late = await call('/api/admin/session', { json: { token: tokenFromMail() } });
    expect(late.status).toBe(401);
    expect(late.headers.get('Set-Cookie')).toBeNull();
  });

  it('sessions end on logout, after 24 hours, or when the address leaves ADMIN_EMAILS', async () => {
    const cookie = await signIn();
    expect(await (await call('/api/admin/me', { cookie })).json()).toMatchObject({
      email: ADMIN_EMAIL,
    });
    expect(
      (await call('/api/admin/me', { cookie, env: { ...adminEnv, ADMIN_EMAILS: 'x@y.pt' } }))
        .status,
    ).toBe(401);

    clockNow = new Date('2026-11-12T10:00:00Z');
    expect((await call('/api/admin/me', { cookie })).status).toBe(401);

    clockNow = NOW;
    const second = await signIn();
    const out = await call('/api/admin/logout', { method: 'POST', cookie: second });
    expect(out.headers.get('Set-Cookie')).toContain('admin_session=;');
    expect((await call('/api/admin/me', { cookie: second })).status).toBe(401);
  });

  it('writes need the X-Admin-Request header and a same-origin Origin (CSRF)', async () => {
    const cookie = await signIn();
    await insertEvent({ id: IDS.a, status: 'pending', occurrences: [] });
    const action = { json: { action: 'publish' }, cookie };
    expect(
      (await call(`/api/admin/events/${IDS.a}/moderate`, { ...action, csrf: false })).status,
    ).toBe(403);
    expect(
      (
        await call(`/api/admin/events/${IDS.a}/moderate`, {
          ...action,
          origin: 'https://mal.example',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`/api/admin/events/${IDS.a}/moderate`, { ...action, origin: 'http://localhost' }))
        .status,
    ).toBe(200);
    expect(
      (await call('/api/admin/login', { json: { email: ADMIN_EMAIL }, csrf: false })).status,
    ).toBe(403);
  });

  it('limits login requests per client', async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (await call('/api/admin/login', { json: { email: 'a@b.pt' }, ip: '203.0.113.1' })).status,
      ).toBe(202);
    }
    expect(
      (await call('/api/admin/login', { json: { email: 'a@b.pt' }, ip: '203.0.113.1' })).status,
    ).toBe(429);
  });

  it('every admin route except sign-in needs a session (and returns no data without one)', async () => {
    const open = new Set(['/api/admin/login', '/api/admin/session', '/api/admin/logout']);
    const routes = realApp.routes.filter(
      (r) => r.path.startsWith('/api/admin') && r.method !== 'ALL' && !open.has(r.path),
    );
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const r of routes) {
      const path = r.path.replace(':id', IDS.a);
      const res = await call(path, { method: r.method, json: r.method === 'GET' ? undefined : {} });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
  });
});

describe('admin: events', () => {
  let cookie: string;
  beforeEach(async () => {
    cookie = await signIn();
    await insertEvent({
      id: IDS.a,
      title: 'Evento pendente',
      status: 'pending',
      occurrences: [{ localDate: '2026-11-20', startTime: '18:00' }],
    });
    await insertEvent({
      id: IDS.b,
      title: 'Evento reportado e oculto',
      status: 'hidden',
      occurrences: [{ localDate: '2026-11-21', startTime: '18:00' }],
    });
    for (let i = 0; i < 3; i++) await insertReport(IDS.b);
    await insertEvent({
      id: IDS.c,
      title: 'Evento publicado',
      verified: true,
      occurrences: [
        { localDate: '2026-11-01', startTime: '18:00' },
        { localDate: '2026-11-25', startTime: '18:00', cancelled: true },
        { localDate: '2026-11-28', startTime: '10:00' },
      ],
    });
    await insertReport(IDS.c, 'wrong_info');
  });

  const list = async (filter: string, q = '') =>
    AdminEventListSchema.parse(
      await (
        await call(`/api/admin/events?filter=${filter}&q=${encodeURIComponent(q)}`, { cookie })
      ).json(),
    ).items;

  it('queues: pending, reported (most reports first), hidden, all; search', async () => {
    expect((await list('pending')).map((e) => e.id)).toEqual([IDS.a]);
    expect((await list('reported')).map((e) => [e.id, e.reports])).toEqual([
      [IDS.b, 3],
      [IDS.c, 1],
    ]);
    expect((await list('hidden')).map((e) => e.id)).toEqual([IDS.b]);
    expect(await list('all')).toHaveLength(3);
    expect((await list('all', 'publicado')).map((e) => e.id)).toEqual([IDS.c]);
    expect((await list('all', '%')).map((e) => e.id)).toEqual([]);
    const published = (await list('all', 'publicado'))[0];
    // The next date skips the cancelled one.
    expect(published?.nextStartsAt).toBe('2026-11-28T10:00:00Z');
    expect(published?.verified).toBe(true);
  });

  it('detail includes the contact email and the reports', async () => {
    const res = await call(`/api/admin/events/${IDS.b}`, { cookie });
    const detail = AdminEventDetailSchema.parse(await res.json());
    expect(detail.contactEmail).toBe('segredo.organizacao@exemplo.pt');
    expect(detail.reports).toHaveLength(3);
    expect(detail.status).toBe('hidden');
    expect((await call('/api/admin/events/01JC0000000000000000000ZZZ', { cookie })).status).toBe(
      404,
    );
  });

  it('approving publishes and dismisses reports; hiding removes from the map', async () => {
    const res = await call(`/api/admin/events/${IDS.b}/moderate`, {
      json: { action: 'publish' },
      cookie,
    });
    expect(await res.json()).toMatchObject({ id: IDS.b, status: 'published', reports: 0 });
    const geo = async () =>
      PublicEventCollectionSchema.parse(
        await (await call('/api/events.geojson')).json(),
      ).features.map((f) => f.id);
    expect(await geo()).toContain(IDS.b);

    await call(`/api/admin/events/${IDS.b}/moderate`, { json: { action: 'hide' }, cookie });
    expect(await geo()).not.toContain(IDS.b);
  });

  it('marks and unmarks "Confirmado"', async () => {
    const r1 = await call(`/api/admin/events/${IDS.c}/moderate`, {
      json: { action: 'unverify' },
      cookie,
    });
    expect(await r1.json()).toMatchObject({ verified: false });
    const r2 = await call(`/api/admin/events/${IDS.c}/moderate`, {
      json: { action: 'verify' },
      cookie,
    });
    expect(await r2.json()).toMatchObject({ verified: true });
    expect(
      (await call(`/api/admin/events/${IDS.c}/moderate`, { json: { action: 'delete' }, cookie }))
        .status,
    ).toBe(400);
  });

  it('marks an event as ongoing ("sem fim"): on the map every day until hidden', async () => {
    // Its only date has passed: a normal event would be off the map.
    await insertEvent({
      id: IDS.d,
      title: 'Acampamento',
      occurrences: [
        { localDate: '2026-10-12', startTime: null, cancelled: true },
        { localDate: '2026-10-13', startTime: '18:00' },
      ],
    });
    const geo = async () =>
      PublicEventCollectionSchema.parse(await (await call('/api/events.geojson')).json()).features;
    expect((await geo()).map((f) => f.id)).not.toContain(IDS.d);

    const r1 = await call(`/api/admin/events/${IDS.d}/moderate`, {
      json: { action: 'ongoing' },
      cookie,
    });
    expect(await r1.json()).toMatchObject({ id: IDS.d, ongoing: true, nextStartsAt: null });
    const feature = (await geo()).find((f) => f.id === IDS.d);
    expect(feature?.properties.ongoingSince).toBe('2026-10-13');
    expect((await list('all')).find((e) => e.id === IDS.d)?.ongoing).toBe(true);
    const detail = AdminEventDetailSchema.parse(
      await (await call(`/api/admin/events/${IDS.d}`, { cookie })).json(),
    );
    expect(detail).toMatchObject({ ongoing: true, ongoingSince: '2026-10-13' });

    await call(`/api/admin/events/${IDS.d}/moderate`, { json: { action: 'hide' }, cookie });
    expect((await geo()).map((f) => f.id)).not.toContain(IDS.d);
    await call(`/api/admin/events/${IDS.d}/moderate`, { json: { action: 'publish' }, cookie });
    expect((await geo()).map((f) => f.id)).toContain(IDS.d);

    const r2 = await call(`/api/admin/events/${IDS.d}/moderate`, {
      json: { action: 'not_ongoing' },
      cookie,
    });
    expect(await r2.json()).toMatchObject({ ongoing: false });
    expect((await geo()).map((f) => f.id)).not.toContain(IDS.d);
    // Normal events carry ongoingSince: null.
    expect((await geo()).find((f) => f.id === IDS.c)?.properties.ongoingSince).toBeNull();
  });

  it('edits keep "Confirmado" and follow the same date rules', async () => {
    const detail = AdminEventDetailSchema.parse(
      await (await call(`/api/admin/events/${IDS.c}`, { cookie })).json(),
    );
    const body = {
      type: detail.type,
      title: 'Título corrigido pela moderação',
      description: detail.description,
      organizer: detail.organizer,
      placeLabel: detail.placeLabel,
      occurrences: detail.occurrences.map((o) => ({
        id: o.id,
        localDate: o.localDate,
        startTime: o.startTime === '10:00' ? '11:00' : o.startTime,
        endTime: o.endTime,
        note: o.note,
        cancelled: o.cancelled,
      })),
    };
    const res = await call(`/api/admin/events/${IDS.c}`, { method: 'PATCH', json: body, cookie });
    expect(res.status).toBe(200);
    const updated = AdminEventDetailSchema.parse(await res.json());
    expect(updated.title).toBe('Título corrigido pela moderação');
    expect(updated.verified).toBe(true);
    expect(updated.occurrences.map((o) => o.startTime)).toEqual(['18:00', '18:00', '11:00']);

    const bad = await call(`/api/admin/events/${IDS.c}`, {
      method: 'PATCH',
      json: { ...body, title: 'x' },
      cookie,
    });
    expect(bad.status).toBe(400);
  });
});

describe('admin: signatures', () => {
  let cookie: string;
  // Valid ULIDs (Crockford base32).
  const S = {
    person: '01JE0000000000000000000001',
    hidden: '01JE0000000000000000000002',
    unconfirmed: '01JE0000000000000000000003',
    orgPending: '01JE0000000000000000000004',
    orgApproved: '01JE0000000000000000000005',
    orgUnconfirmed: '01JE0000000000000000000006',
  };

  beforeEach(async () => {
    cookie = await signIn();
    await insertSignature({
      id: S.person,
      email: 'ana@exemplo.pt',
      firstName: 'Ana',
      lastName: 'Silva',
    });
    await insertSignature({
      id: S.hidden,
      isPublic: false,
      canContact: false,
      email: 'b@exemplo.pt',
    });
    await insertSignature({ id: S.unconfirmed, status: 'unconfirmed', email: 'c@exemplo.pt' });
    await insertSignature({
      id: S.orgPending,
      kind: 'organization',
      orgName: 'Sindicato Por Aprovar',
      email: 'geral@sindicato.pt',
      contactName: '=HYPERLINK("http://mal.example")',
      createdAt: '2026-11-03T00:00:00Z',
    });
    await insertSignature({
      id: S.orgApproved,
      kind: 'organization',
      status: 'approved',
      orgName: 'Coletivo Aprovado',
      canContact: false,
    });
    await insertSignature({ id: S.orgUnconfirmed, kind: 'organization', status: 'unconfirmed' });
  });

  const list = async (filter: string, q = '') =>
    AdminSignatureListSchema.parse(
      await (
        await call(`/api/admin/signatures?filter=${filter}&q=${encodeURIComponent(q)}`, { cookie })
      ).json(),
    );

  it('queues and search (by email or name)', async () => {
    const pending = await list('orgs_pending');
    expect(pending.items.map((s) => s.id)).toEqual([S.orgPending]);
    expect(pending.items[0]).toMatchObject({
      name: 'Sindicato Por Aprovar',
      email: 'geral@sindicato.pt',
      municipality: 'Porto',
      status: 'confirmed',
    });
    expect((await list('organizations')).total).toBe(2);
    expect((await list('individuals')).total).toBe(2);
    expect((await list('unconfirmed')).total).toBe(2);
    expect((await list('individuals', 'ANA@exemplo')).items.map((s) => s.id)).toEqual([S.person]);
    expect((await list('individuals', 'silva')).items.map((s) => s.name)).toEqual(['Ana Silva']);
  });

  it('approving an organisation puts it on the public list; rejecting takes it off', async () => {
    const res = await call(`/api/admin/signatures/${S.orgPending}/moderate`, {
      json: { action: 'approve' },
      cookie,
    });
    expect(await res.json()).toMatchObject({ status: 'approved' });
    const pub = async () =>
      PublicSignaturesSchema.parse(
        await (await call('/api/signatures/public')).json(),
      ).organizations.map((o) => o.name);
    expect(await pub()).toContain('Sindicato Por Aprovar');
    await call(`/api/admin/signatures/${S.orgPending}/moderate`, {
      json: { action: 'reject' },
      cookie,
    });
    expect(await pub()).not.toContain('Sindicato Por Aprovar');
  });

  it('only confirmed organisations can be moderated', async () => {
    for (const id of [S.person, S.orgUnconfirmed]) {
      const res = await call(`/api/admin/signatures/${id}/moderate`, {
        json: { action: 'approve' },
        cookie,
      });
      expect(res.status).toBe(409);
    }
  });

  it('deletes a signature on request', async () => {
    const res = await call(`/api/admin/signatures/${S.person}`, { method: 'DELETE', cookie });
    expect(await res.json()).toEqual({ deleted: true });
    expect((await list('individuals', 'ana@')).total).toBe(0);
    expect(
      (await call(`/api/admin/signatures/${S.person}`, { method: 'DELETE', cookie })).status,
    ).toBe(404);
  });

  it('exports only confirmed people/organisations that accepted to be contacted', async () => {
    const res = await call('/api/admin/signatures/export.csv', { cookie });
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="contactos-2026-11-11.csv"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // UTF-8 BOM, so Excel reads the accents correctly.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]?.startsWith('Tipo;Nome próprio;Apelido;Pseudónimo;Organização')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(csv).toContain('ana@exemplo.pt');
    expect(csv).toContain('geral@sindicato.pt');
    expect(csv).not.toContain('b@exemplo.pt'); // no consent to be contacted
    expect(csv).not.toContain('c@exemplo.pt'); // unconfirmed
    expect(csv).not.toContain('Coletivo Aprovado'); // no consent
    // Formula injection neutralised and quoted.
    expect(csv).toContain(`"'=HYPERLINK(""http://mal.example"")"`);
  });
});

describe('csvCell', () => {
  it('quotes separators and quotes, neutralises formulas', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell('Porto')).toBe('Porto');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "olá"')).toBe('"diz ""olá"""');
    expect(csvCell('linha\nnova')).toBe('"linha\nnova"');
    expect(csvCell('+351 912')).toBe("'+351 912");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('signatures switched off (FEATURES)', () => {
  it('admin signature routes do not exist, and /me says so', async () => {
    const launch = createApp({
      clock: () => clockNow,
      mailer: () => mailer,
      rateLimiter: () => limiter,
      features: { signatures: false, privacyPage: false, eventContactEmail: false },
    });
    const req = (path: string, init: RequestInit = {}) =>
      launch.request(`http://localhost${path}`, init, adminEnv);
    await req('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
      body: JSON.stringify({ email: ADMIN_EMAIL }),
    });
    const session = await req('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
      body: JSON.stringify({ token: tokenFromMail() }),
    });
    const cookie = /admin_session=([^;]+)/.exec(session.headers.get('Set-Cookie') ?? '')?.[1];
    const headers = { Cookie: `admin_session=${cookie ?? ''}` };
    expect(await (await req('/api/admin/me', { headers })).json()).toEqual({
      email: ADMIN_EMAIL,
      features: { signatures: false, privacyPage: false, eventContactEmail: false },
    });
    expect((await req('/api/admin/signatures', { headers })).status).toBe(404);
    expect((await req('/api/admin/signatures/export.csv', { headers })).status).toBe(404);
    expect((await req('/api/admin/events', { headers })).status).toBe(200);
  });
});
