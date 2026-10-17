import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONSENT_TEXT_VERSION } from '../../src/config/signatures';
import { createApp } from '../../src/server/app';
import type { AppDeps } from '../../src/server/deps';
import { FakeMailer } from '../../src/server/mailer';
import type { SignatureRow } from '../../src/server/repos/signatures-repo';
import { FakeCaptcha } from '../../src/server/security/captcha';
import { hashToken } from '../../src/server/security/tokens';
import { MemoryRateLimiter } from '../../src/server/security/rate-limit';
import { PublicSignaturesSchema, SignatureStatsSchema } from '../../src/shared/schemas';
import { insertSignature, resetDb } from './fixtures';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');
let clockNow = NOW;

let mailer: FakeMailer;
let limiter: MemoryRateLimiter;
let ids = 0;

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    clock: () => clockNow,
    captcha: () => new FakeCaptcha(true),
    mailer: () => mailer,
    rateLimiter: () => limiter,
    newId: () => `01JD${String(++ids).padStart(22, '0')}`,
    ...overrides,
  });
}

function post(
  path: string,
  body: unknown,
  opts: { ip?: string; app?: ReturnType<typeof makeApp> } = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.ip) headers['CF-Connecting-IP'] = opts.ip;
  return (opts.app ?? makeApp()).request(
    `http://localhost${path}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    env,
  );
}

function postForm(fields: Record<string, string>, accept?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (accept) headers.Accept = accept;
  return makeApp().request(
    'http://localhost/api/signatures',
    { method: 'POST', headers, body: new URLSearchParams(fields).toString() },
    env,
  );
}

const get = (path: string) => makeApp().request(`http://localhost${path}`, {}, env);

function individual(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'individual',
    firstName: ' Ana ',
    lastName: 'Exemplo',
    pseudonym: '',
    activity: 'Professora',
    email: ' Ana@Exemplo.PT ',
    municipality: '1312',
    phone: '',
    isPublic: true,
    canContact: false,
    consent: true,
    turnstileToken: 'token',
    website: '',
    ...overrides,
  };
}

function organization(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'organization',
    orgName: 'Associação Fictícia do Bairro',
    orgType: 'association',
    site: 'associacao-ficticia.pt',
    contactName: 'Pessoa Responsável',
    email: 'geral@associacao-ficticia.pt',
    municipality: '1106',
    phone: '213 000 000',
    legitimacy: true,
    isPublic: true,
    canContact: true,
    consent: true,
    turnstileToken: 'token',
    ...overrides,
  };
}

async function rows(): Promise<SignatureRow[]> {
  return (
    await env.DB.prepare('SELECT * FROM signatures ORDER BY created_at, id').all<SignatureRow>()
  ).results;
}

function linksIn(text: string) {
  const confirm = /\/api\/signatures\/confirm\?token=([\w-]+)/.exec(text)?.[1];
  const withdraw = /\/apoio\/retirar\/#t=([\w-]+)/.exec(text)?.[1];
  return { confirm, withdraw };
}

async function signAndGetToken(body = individual()): Promise<string> {
  const res = await post('/api/signatures', body);
  expect(res.status).toBe(202);
  const token = linksIn(mailer.last()?.text ?? '').confirm;
  expect(token).toBeTruthy();
  return token ?? '';
}

beforeEach(async () => {
  await resetDb();
  mailer = new FakeMailer();
  limiter = new MemoryRateLimiter();
  clockNow = NOW;
});

describe('POST /api/signatures — individual', () => {
  it('stores an unconfirmed signature and emails the confirmation and withdraw links', async () => {
    const res = await post('/api/signatures', individual());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'check_email' });

    const [row] = await rows();
    expect(row).toMatchObject({
      kind: 'individual',
      first_name: 'Ana',
      last_name: 'Exemplo',
      pseudonym: null,
      activity: 'Professora',
      email: 'ana@exemplo.pt',
      municipality: '1312',
      phone: null,
      is_public: 1,
      can_contact: 0,
      status: 'unconfirmed',
      consent_text_version: CONSENT_TEXT_VERSION,
      created_at: '2026-11-11T10:00:00Z',
      confirmed_at: null,
    });

    const mail = mailer.last();
    expect(mail?.to).toBe('ana@exemplo.pt');
    const { confirm, withdraw } = linksIn(mail?.text ?? '');
    expect(confirm).toMatch(/^[\w-]{43}$/);
    expect(withdraw).toBe(confirm);
    expect(mail?.text).toContain('http://localhost/api/signatures/confirm?token=');
    expect(mail?.text).toContain('18 de novembro de 2026, 10:00');
    // Only the hash is stored.
    expect(row?.confirm_token_hash).toBe(await hashToken(confirm ?? ''));
  });

  it('accepts a pseudonym alone', async () => {
    const res = await post(
      '/api/signatures',
      individual({ firstName: '', lastName: '', pseudonym: 'Gaivota' }),
    );
    expect(res.status).toBe(202);
    expect((await rows())[0]).toMatchObject({
      first_name: null,
      last_name: null,
      pseudonym: 'Gaivota',
    });
  });

  it('needs first name + last name, or a pseudonym', async () => {
    const res = await post('/api/signatures', individual({ firstName: '', lastName: '' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: { path: string[]; code: string }[] };
    expect(body.issues).toEqual(
      expect.arrayContaining([
        { path: ['firstName'], code: 'name_or_pseudonym' },
        { path: ['lastName'], code: 'name_or_pseudonym' },
      ]),
    );
    const onlyFirst = await post('/api/signatures', individual({ lastName: ' ' }));
    expect(((await onlyFirst.json()) as { issues: unknown[] }).issues).toEqual([
      { path: ['lastName'], code: 'name_or_pseudonym' },
    ]);
  });

  it('reports every invalid field at once', async () => {
    const res = await post(
      '/api/signatures',
      individual({
        firstName: '',
        lastName: '',
        email: 'nope',
        municipality: '9999',
        phone: '12',
        consent: false,
        activity: 'liga-me: 912 345 678',
      }),
    );
    expect(res.status).toBe(400);
    const { issues } = (await res.json()) as { issues: { path: string[]; code: string }[] };
    expect(issues.map((i) => `${i.path.join('.')}:${i.code}`).sort()).toEqual([
      'activity:contact_in_public_field',
      'consent:required',
      'email:invalid_email',
      'firstName:name_or_pseudonym',
      'lastName:name_or_pseudonym',
      'municipality:required',
      'phone:invalid_phone',
    ]);
    expect(await rows()).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('rejects an email address in a public field', async () => {
    const res = await post('/api/signatures', individual({ pseudonym: 'ana@exemplo.pt' }));
    expect(res.status).toBe(400);
  });

  it('rejects the honeypot without storing anything', async () => {
    const res = await post('/api/signatures', individual({ website: 'http://spam.example' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'rejected' });
    expect(await rows()).toHaveLength(0);
  });

  it('fails when Turnstile fails or the token is missing', async () => {
    const app = makeApp({ captcha: () => new FakeCaptcha(false) });
    expect((await post('/api/signatures', individual(), { app })).status).toBe(400);
    const res = await post('/api/signatures', individual({ turnstileToken: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'captcha_failed' });
    expect(await rows()).toHaveLength(0);
  });

  it('limits signatures to 10 per hour per client', async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i++) {
      const res = await post('/api/signatures', individual({ email: `p${i}@exemplo.pt` }), {
        app,
        ip: '203.0.113.9',
      });
      expect(res.status).toBe(202);
    }
    const res = await post('/api/signatures', individual({ email: 'p10@exemplo.pt' }), {
      app,
      ip: '203.0.113.9',
    });
    expect(res.status).toBe(429);
    const other = await post('/api/signatures', individual({ email: 'p11@exemplo.pt' }), {
      app,
      ip: '203.0.113.10',
    });
    expect(other.status).toBe(202);
  });
});

describe('POST /api/signatures — organisation', () => {
  it('stores the organisation; contact data never public', async () => {
    const res = await post('/api/signatures', organization());
    expect(res.status).toBe(202);
    expect((await rows())[0]).toMatchObject({
      kind: 'organization',
      org_name: 'Associação Fictícia do Bairro',
      org_type: 'association',
      website: 'https://associacao-ficticia.pt/',
      contact_name: 'Pessoa Responsável',
      phone: '213 000 000',
      is_public: 1,
      can_contact: 1,
      status: 'unconfirmed',
    });
    expect(mailer.last()?.text).toContain('em nome de "Associação Fictícia do Bairro"');
  });

  it('requires legitimacy, publication consent, the contact name and a valid type', async () => {
    const res = await post(
      '/api/signatures',
      organization({
        legitimacy: false,
        isPublic: false,
        contactName: ' ',
        orgType: 'club',
        site: 'nope',
      }),
    );
    expect(res.status).toBe(400);
    const { issues } = (await res.json()) as { issues: { path: string[]; code: string }[] };
    expect(issues.map((i) => `${i.path.join('.')}:${i.code}`).sort()).toEqual([
      'contactName:required',
      'isPublic:required',
      'legitimacy:required',
      'orgType:required',
      'site:invalid_url',
    ]);
  });

  it('the same address can sign as a person and for an organisation', async () => {
    await post('/api/signatures', individual({ email: 'geral@associacao-ficticia.pt' }));
    await post('/api/signatures', organization());
    expect(await rows()).toHaveLength(2);
  });
});

describe('repeated address (SPEC §5.3 step 4)', () => {
  it('unconfirmed: no duplicate, same neutral answer, a new link that replaces the old one', async () => {
    const first = await signAndGetToken();
    clockNow = new Date('2026-11-15T10:00:00Z');
    const res = await post(
      '/api/signatures',
      individual({ firstName: 'Outro', email: 'ana@exemplo.pt' }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'check_email' });

    const all = await rows();
    expect(all).toHaveLength(1);
    // Nothing is overwritten; the 7 days restart.
    expect(all[0]).toMatchObject({ first_name: 'Ana', created_at: '2026-11-15T10:00:00Z' });
    expect(mailer.sent).toHaveLength(2);
    const second = linksIn(mailer.last()?.text ?? '').confirm ?? '';
    expect(second).not.toBe(first);

    expect((await get(`/api/signatures/confirm?token=${first}`)).headers.get('Location')).toBe(
      '/apoio/link-invalido/',
    );
    expect((await get(`/api/signatures/confirm?token=${second}`)).headers.get('Location')).toBe(
      '/apoio/obrigado/',
    );
  });

  it('confirmed: nothing changes, an email with a withdraw link', async () => {
    const token = await signAndGetToken();
    await get(`/api/signatures/confirm?token=${token}`);
    const res = await post('/api/signatures', individual({ lastName: 'Mudado' }));
    expect(res.status).toBe(202);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: 'confirmed', last_name: 'Exemplo' });
    const mail = mailer.last();
    expect(mail?.subject).toBe('A tua assinatura do apelo');
    const { confirm, withdraw } = linksIn(mail?.text ?? '');
    expect(confirm).toBeUndefined();
    expect(withdraw).toBeTruthy();
  });

  it('rejected organisation: no email', async () => {
    await insertSignature({
      id: '01JD0000000000000000000REJ',
      kind: 'organization',
      status: 'rejected',
      email: 'geral@associacao-ficticia.pt',
    });
    expect((await post('/api/signatures', organization())).status).toBe(202);
    expect(mailer.sent).toHaveLength(0);
  });

  it('sends at most 3 emails per address per day, answering the same way', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post('/api/signatures', individual(), { ip: `203.0.113.${i}` })).status).toBe(
        202,
      );
    }
    expect(mailer.sent).toHaveLength(3);
  });
});

describe('GET /api/signatures/confirm', () => {
  it('confirms and redirects to the thanks page; idempotent', async () => {
    const token = await signAndGetToken();
    const res = await get(`/api/signatures/confirm?token=${token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/apoio/obrigado/');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect((await rows())[0]).toMatchObject({
      status: 'confirmed',
      confirmed_at: '2026-11-11T10:00:00Z',
    });
    const again = await get(`/api/signatures/confirm?token=${token}`);
    expect(again.headers.get('Location')).toBe('/apoio/obrigado/');
  });

  it('rejects unknown and malformed tokens', async () => {
    for (const t of ['x'.repeat(43), 'nope', '']) {
      const res = await get(`/api/signatures/confirm?token=${t}`);
      expect(res.status).toBe(303);
      expect(res.headers.get('Location')).toBe('/apoio/link-invalido/');
    }
  });

  it('expires after 7 days', async () => {
    const token = await signAndGetToken();
    clockNow = new Date('2026-11-18T10:00:00Z');
    expect((await get(`/api/signatures/confirm?token=${token}`)).headers.get('Location')).toBe(
      '/apoio/link-invalido/',
    );
    expect((await rows())[0]?.status).toBe('unconfirmed');
  });

  it('is valid until just before the 7 days end', async () => {
    const token = await signAndGetToken();
    clockNow = new Date('2026-11-18T09:59:00Z');
    expect((await get(`/api/signatures/confirm?token=${token}`)).headers.get('Location')).toBe(
      '/apoio/obrigado/',
    );
  });
});

describe('POST /api/signatures/withdraw', () => {
  it('deletes the signature, confirmed or not', async () => {
    const token = await signAndGetToken();
    await get(`/api/signatures/confirm?token=${token}`);
    const res = await post('/api/signatures/withdraw', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ withdrawn: true });
    expect(await rows()).toHaveLength(0);
    expect((await post('/api/signatures/withdraw', { token })).status).toBe(404);
  });

  it('404 for a wrong or malformed token', async () => {
    await signAndGetToken();
    expect((await post('/api/signatures/withdraw', { token: 'y'.repeat(43) })).status).toBe(404);
    expect((await post('/api/signatures/withdraw', { token: 1 })).status).toBe(404);
    expect(await rows()).toHaveLength(1);
  });
});

describe('stats and public list', () => {
  beforeEach(async () => {
    // Individuals (confirmed_at decides the order).
    await insertSignature({
      id: '01JD00000000000000000000I1',
      firstName: 'Ana',
      lastName: 'Primeira',
      confirmedAt: '2026-11-02T10:00:00Z',
    });
    await insertSignature({
      id: '01JD00000000000000000000I2',
      pseudonym: 'Gaivota',
      confirmedAt: '2026-11-03T10:00:00Z',
      municipality: '1106',
    });
    await insertSignature({ id: '01JD00000000000000000000I3', isPublic: false });
    await insertSignature({ id: '01JD00000000000000000000I4', status: 'unconfirmed' });
    // Organisations.
    await insertSignature({
      id: '01JD00000000000000000000O1',
      kind: 'organization',
      status: 'approved',
      orgName: 'Sindicato Fictício',
    });
    await insertSignature({
      id: '01JD00000000000000000000O2',
      kind: 'organization',
      status: 'confirmed',
      orgName: 'Coletivo Por Aprovar',
    });
    await insertSignature({
      id: '01JD00000000000000000000O3',
      kind: 'organization',
      status: 'rejected',
    });
    await insertSignature({
      id: '01JD00000000000000000000O4',
      kind: 'organization',
      status: 'unconfirmed',
    });
  });

  it('counts confirmed individuals (public or not) and confirmed/approved organisations', async () => {
    const res = await get('/api/signatures/stats');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    expect(SignatureStatsSchema.parse(await res.json())).toEqual({
      supporters: 3,
      organizations: 2,
    });
  });

  it('lists public confirmed individuals (newest first) and approved organisations only', async () => {
    const res = await get('/api/signatures/public');
    const body = PublicSignaturesSchema.parse(await res.json());
    expect(body.organizations).toEqual([
      {
        name: 'Sindicato Fictício',
        type: 'collective',
        municipality: 'Porto',
        website: 'https://exemplo.pt/',
      },
    ]);
    expect(body.individuals.map((i) => i.name)).toEqual(['Gaivota', 'Ana Primeira']);
    expect(body.individuals[1]).toEqual({
      name: 'Ana Primeira',
      activity: 'Profissão fictícia',
      municipality: 'Porto',
    });
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
  });

  it('filters by municipality', async () => {
    const body = PublicSignaturesSchema.parse(
      await (await get('/api/signatures/public?municipality=1106')).json(),
    );
    expect(body.individuals.map((i) => i.name)).toEqual(['Gaivota']);
    expect(body.individuals[0]?.municipality).toBe('Lisboa');
    expect(body.organizations).toEqual([]);
    expect((await get('/api/signatures/public?municipality=9999')).status).toBe(400);
  });

  it('paginates individuals; organisations only on the first page', async () => {
    for (let i = 0; i < 55; i++) {
      await insertSignature({
        id: `01JD0000000000000000000P${String(i).padStart(2, '0')}`,
        confirmedAt: `2026-11-10T10:${String(i).padStart(2, '0')}:00Z`,
      });
    }
    const p1 = PublicSignaturesSchema.parse(
      await (await get('/api/signatures/public?page=1')).json(),
    );
    const p2 = PublicSignaturesSchema.parse(
      await (await get('/api/signatures/public?page=2')).json(),
    );
    expect(p1.total).toBe(57);
    expect(p1.individuals).toHaveLength(50);
    expect(p2.individuals).toHaveLength(7);
    expect(p2.organizations).toEqual([]);
    expect(p2.individuals.at(-1)?.name).toBe('Ana Primeira');
  });
});

describe('the form without JavaScript (SPEC §9)', () => {
  const fields = {
    kind: 'individual',
    firstName: 'Ana',
    lastName: 'Exemplo',
    email: 'ana@exemplo.pt',
    municipality: '1312',
    consent: 'on',
    isPublic: 'on',
    'cf-turnstile-response': 'token',
  };

  it('a valid form redirects to the "check your email" page', async () => {
    const res = await postForm(fields);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/apoio/confirma-email/');
    expect((await rows())[0]).toMatchObject({
      is_public: 1,
      can_contact: 0,
      status: 'unconfirmed',
    });
  });

  it('errors come back as an HTML page that lists them without echoing the input', async () => {
    const res = await postForm({ ...fields, firstName: '', email: 'nope@' });
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<strong>Nome próprio:</strong> Indica o nome próprio e o apelido');
    expect(html).toContain('<strong>Email:</strong> Email inválido.');
    expect(html).not.toContain('nope@');
    expect(html).toContain('href="/apoio/#assinar"');
  });

  it('without the Turnstile token: explains that the check needs JavaScript', async () => {
    const res = await postForm({ ...fields, 'cf-turnstile-response': '' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Precisa de JavaScript');
    expect(await rows()).toHaveLength(0);
  });

  it('a form POST asking for JSON gets JSON (the enhanced form)', async () => {
    const res = await postForm(fields, 'application/json');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'check_email' });
  });
});
