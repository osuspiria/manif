import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FEATURES } from '../../src/config/app';

/**
 * /admin (SPEC §6). The e2e server runs with DEV_MAILBOX=on and an ADMIN_EMAILS
 * address per project (the projects run in parallel; a shared address would
 * mix their single-use links), so the magic link is read from the dev mailbox.
 */
const adminFor = (info: { project: { name: string } }) =>
  `admin-${info.project.name}@exemplo.invalid`;

interface Mail {
  text: string;
}

async function mails(request: APIRequestContext, to: string): Promise<Mail[]> {
  const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  return ((await res.json()) as { messages: Mail[] }).messages;
}

async function nextMail(request: APIRequestContext, to: string, before: number): Promise<string> {
  let all: Mail[] = [];
  await expect
    .poll(async () => (all = await mails(request, to)).length, { timeout: 15_000 })
    .toBeGreaterThan(before);
  return all.at(-1)?.text ?? '';
}

const unique = (info: { project: { name: string } }) =>
  `${info.project.name}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

async function signIn(page: Page, request: APIRequestContext, admin: string) {
  const before = (await mails(request, admin)).length;
  await page.goto('/admin/');
  await page.getByLabel('Email', { exact: true }).fill(admin);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByRole('status')).toHaveText(/Se o email estiver autorizado/);
  const link = /(https?:\/\/\S+\/admin\/entrar\/#t=[\w-]+)/.exec(
    await nextMail(request, admin, before),
  )?.[1];
  expect(link).toBeTruthy();
  await page.goto(link ?? '');
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(page.getByText(`Sessão: ${admin}`)).toBeVisible();
}

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });
}

function dayFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('Administração', () => {
  test('without a session: login form, and the API refuses', async ({ page, request }) => {
    await page.goto('/admin/');
    await expect(page.getByRole('heading', { name: 'Entrar na administração' })).toBeVisible();
    expect((await request.get('/api/admin/events')).status()).toBe(401);
    // An address outside the allowlist gets the same answer.
    await page.getByLabel('Email', { exact: true }).fill('intruso@exemplo.invalid');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toHaveText(/Se o email estiver autorizado/);
    expect(await mails(request, 'intruso@exemplo.invalid')).toEqual([]);
  });

  test('a used or invalid link does not sign in', async ({ page }) => {
    await page.goto('/admin/entrar/#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await expect(page.getByRole('alert')).toHaveText(/não é válido/);
    await expect(page).toHaveURL(/\/admin\/entrar\/$/);
  });

  test('moderates a reported event: approve, edit, hide', async ({
    page,
    request,
    context,
  }, info) => {
    const title = `[Teste] Reportado ${unique(info)}`;
    const created = await request.post('/api/events', {
      headers: { 'CF-Connecting-IP': randomIp() },
      data: {
        type: 'rally',
        title,
        lat: 38.7139,
        lng: -9.1394,
        occurrences: [{ localDate: dayFromNow(5), startTime: '18:00', endTime: null, note: null }],
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (let i = 0; i < 3; i++) {
      const r = await request.post(`/api/events/${id}/report`, {
        headers: { 'CF-Connecting-IP': randomIp() },
        data: { reason: 'fake' },
      });
      expect(r.status()).toBe(201);
    }
    const onMap = async () =>
      (
        (await (await request.get('/api/events.geojson')).json()) as { features: { id: string }[] }
      ).features.some((f) => f.id === id);
    expect(await onMap()).toBe(false); // hidden after 3 reports

    await signIn(page, request, adminFor(info));
    // Only the admin API path carries the cookie; the public site has none.
    expect(await context.cookies(new URL('/', page.url()).toString())).toEqual([]);
    const [cookie] = await context.cookies(new URL('/api/admin/me', page.url()).toString());
    expect(cookie).toMatchObject({ name: 'admin_session', httpOnly: true, sameSite: 'Strict' });

    // Opens on the verification queue; every queue but "Todos" shows its count
    // (other tests change them, so only their presence is checked).
    const queue = page.getByRole('button', { name: /^Por confirmar \d+$/ });
    await expect(queue).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Reportados \d+$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Todos', exact: true })).toBeVisible();
    // The top of the page only: the queue holds every seeded event.
    await page.screenshot({
      path: `test-results/screens/${info.project.name}-29-admin-por-confirmar.png`,
    });

    // Activity (decisions #82): closed until opened; the e2e server never ran the
    // daily job, so the warning shows.
    await expect(page.getByRole('alert')).toContainText('trabalho diário');
    await page.getByText('Atividade dos últimos 14 dias').click();
    const activity = page.getByRole('table');
    await expect(activity.getByRole('row')).toHaveCount(15);
    await activity.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/screens/${info.project.name}-31-admin-atividade.png`,
    });

    await page.getByRole('button', { name: 'Reportados' }).click();
    await page.getByLabel('Pesquisar por título ou concelho').fill(title);
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    const card = page.locator(`[data-event-id="${id}"]`);
    await expect(card).toContainText('3 denúncias');
    await expect(card).toContainText('Oculto');
    await shot(page, '30-admin-eventos', info.project.name);

    await card.getByRole('button', { name: 'Aprovar' }).click();
    await expect(card).toContainText('Publicado');
    await expect(card).not.toContainText('denúncias');
    expect(await onMap()).toBe(true);

    await card.getByRole('button', { name: 'Marcar como confirmado' }).click();
    await expect(card.getByRole('button', { name: 'Tirar "Confirmado"' })).toBeVisible();

    // Detail: edit the title (keeps "Confirmado").
    await card.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    await page.getByLabel('Título').fill(`${title} (corrigido)`);
    await page.getByRole('button', { name: 'Guardar alterações' }).click();
    await expect(page.getByText('Alterações guardadas.')).toBeVisible();
    await shot(page, '31-admin-evento', info.project.name);
    const event = (await (await request.get(`/api/events/${id}`)).json()) as {
      title: string;
      verified: boolean;
    };
    expect(event).toMatchObject({ title: `${title} (corrigido)`, verified: true });

    await page.getByRole('button', { name: 'Ocultar' }).click();
    await expect(page.locator('.admin-badges').first()).toContainText('Oculto');
    expect(await onMap()).toBe(false);
  });

  test('marks an event as ongoing ("sem fim"): on the map every day', async ({
    page,
    request,
  }, info) => {
    const title = `[Teste] Sem fim ${unique(info)}`;
    const created = await request.post('/api/events', {
      headers: { 'CF-Connecting-IP': randomIp() },
      data: {
        type: 'camp',
        title,
        lat: 38.7139,
        lng: -9.1394,
        occurrences: [{ localDate: dayFromNow(1), startTime: '18:00', endTime: null, note: null }],
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // An ongoing event fills every day of the strip: hide it once done, so it
    // does not leak into the other specs (empty days in "Escolher dia").
    try {
      await signIn(page, request, adminFor(info));
      await page.getByRole('button', { name: 'Todos', exact: true }).click();
      await page.getByLabel('Pesquisar por título ou concelho').fill(title);
      await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
      const card = page.locator(`[data-event-id="${id}"]`);
      // Moderation may be on: approve first when needed.
      const approve = card.getByRole('button', { name: 'Aprovar' });
      if (await approve.isVisible()) await approve.click();
      await card.getByRole('button', { name: 'Marcar como sem fim' }).click();
      await expect(card.getByRole('button', { name: 'Tirar "Sem fim"' })).toBeVisible();
      await expect(card.locator('.admin-badges')).toContainText('Sem fim');
      await shot(page, '32-admin-sem-fim', info.project.name);

      // Ten days later it is still on the map, as "todo o dia".
      await page.goto(`/?dia=${dayFromNow(10)}&vista=lista`);
      const item = page.locator('.event-card', { hasText: title });
      await expect(item).toBeVisible();
      await expect(item).toContainText('Todos os dias desde');
      await shot(page, '33-lista-sem-fim', info.project.name);
      await item.click();
      await expect(page.locator('.occ-highlight')).toContainText('Todos os dias desde');
    } finally {
      await page.request.post(`/api/admin/events/${id}/moderate`, {
        headers: { 'X-Admin-Request': '1' },
        data: { action: 'hide' },
      });
    }
  });

  test('approves an organisation, deletes a signature, exports CSV', async ({
    page,
    request,
  }, info) => {
    test.skip(!FEATURES.signatures, 'signatures are switched off');
    const id = unique(info);
    const orgName = `Coletivo Admin ${id}`;
    const orgEmail = `org-${id}@exemplo.invalid`;
    const personEmail = `pessoa-${id}@exemplo.invalid`;
    const sign = async (data: Record<string, unknown>, email: string) => {
      const before = (await mails(request, email)).length;
      const r = await request.post('/api/signatures', {
        headers: { 'CF-Connecting-IP': randomIp() },
        data: {
          ...data,
          email,
          municipality: '1106',
          consent: true,
          turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
        },
      });
      expect(r.status()).toBe(202);
      const confirm = /(https?:\/\/\S+\/api\/signatures\/confirm\?token=[\w-]+)/.exec(
        await nextMail(request, email, before),
      )?.[1];
      await request.get(confirm ?? '');
    };
    await sign(
      {
        kind: 'organization',
        orgName,
        orgType: 'collective',
        contactName: 'Pessoa Responsável',
        legitimacy: true,
        isPublic: true,
        canContact: true,
      },
      orgEmail,
    );
    await sign({ kind: 'individual', pseudonym: `Apagar ${id}`, isPublic: true }, personEmail);

    await signIn(page, request, adminFor(info));
    await page.getByRole('link', { name: 'Assinaturas' }).click();
    await page.getByLabel('Pesquisar por nome, organização ou email').fill(orgName);
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    const org = page.locator('.admin-card', { hasText: orgName });
    await expect(org).toContainText(orgEmail);
    await expect(org).toContainText('Confirmada');
    await shot(page, '32-admin-assinaturas', info.project.name);
    await org.getByRole('button', { name: 'Aprovar' }).click();
    await expect(org).toContainText('Aprovada');
    const listed = (await (await request.get('/api/signatures/public')).json()) as {
      organizations: { name: string }[];
    };
    expect(listed.organizations.map((o) => o.name)).toContain(orgName);

    // Deletion on request, found by email.
    await page.getByRole('button', { name: 'Pessoas' }).click();
    await page.getByLabel('Pesquisar por nome, organização ou email').fill(personEmail);
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    const person = page.locator('.admin-card', { hasText: personEmail });
    await person.getByRole('button', { name: 'Apagar' }).click();
    await person.getByRole('button', { name: 'Sim, apagar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Assinatura apagada.' })).toBeVisible();
    await expect(page.locator('.admin-card', { hasText: personEmail })).toHaveCount(0);

    // CSV of those who accepted to be contacted.
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: /Exportar CSV/ }).click();
    const file = await (await download).path();
    const csv = readFileSync(file, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Tipo;Nome próprio;Apelido');
    expect(csv).toContain(orgEmail);
    expect(csv).not.toContain(personEmail);
  });

  test('imports an event from a post and a poster, then publishes it as confirmed', async ({
    page,
    request,
  }, info) => {
    // The e2e server runs with FAKE_EXTERNAL=on: a fixed draft, no call to Claude or Photon.
    const title = `[Teste] Importado ${unique(info)}`;
    await signIn(page, request, adminFor(info));
    await page.getByRole('link', { name: '+ Novo evento' }).click();
    await expect(page).toHaveURL(/#eventos\/novo$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Novo evento' })).toBeVisible();

    await page.getByLabel('Texto do post').fill(`${title}
Sábado às 18h no Rossio`);
    // A 1×1 PNG: shrunk to JPEG in the browser before it is sent.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
    await page
      .getByLabel('Imagem do cartaz ou captura de ecrã')
      .setInputFiles({ name: 'cartaz.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('img', { name: 'Imagem a importar' })).toBeVisible();

    await page.getByRole('button', { name: 'Ler com IA' }).click();
    await expect(page.getByText('Formulário preenchido.')).toBeVisible();
    await expect(page.getByLabel('Título')).toHaveValue(title);
    await expect(page.getByText('Ano assumido pelo extrator de teste.')).toBeVisible();
    await expect(page.getByText('Lisboa · Lisboa')).toBeVisible();
    await shot(page, '34-admin-importar', info.project.name);

    await page.getByRole('button', { name: 'Publicar como confirmado' }).click();
    await expect(page).toHaveURL(/#eventos\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    const id = /#eventos\/([0-9A-Z]{26})$/.exec(page.url())?.[1];
    const event = (await (await request.get(`/api/events/${id}`)).json()) as {
      title: string;
      verified: boolean;
      municipality: string;
    };
    expect(event).toMatchObject({ title, verified: true, municipality: 'Lisboa' });
  });
});
