import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pickPlace, sendEvent } from './send-event';

/**
 * Posters (SPEC §4.7): picked in the add flow, invisible until the moderation
 * approves them, then on the event sheet and in the link preview. Photo
 * metadata never reaches the server.
 */
// Not the addresses of admin.spec.ts: both run in parallel, and one could use up
// the other's single-use sign-in link.
const adminFor = (project: string) => `admin-poster-${project}@exemplo.invalid`;

function dayFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `test-results/screens/${project}-${name}.png` });
}

async function mailCount(request: APIRequestContext, to: string): Promise<string[]> {
  const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
  return ((await res.json()) as { messages: { text: string }[] }).messages.map((m) => m.text);
}

async function signIn(page: Page, request: APIRequestContext, admin: string) {
  const before = (await mailCount(request, admin)).length;
  await page.goto('/admin/');
  await page.getByLabel('Email', { exact: true }).fill(admin);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  let mails: string[] = [];
  await expect
    .poll(async () => (mails = await mailCount(request, admin)).length, { timeout: 15_000 })
    .toBeGreaterThan(before);
  const link = /(https?:\/\/\S+\/admin\/entrar\/#t=[\w-]+)/.exec(mails.at(-1) ?? '')?.[1];
  await page.goto(link ?? '');
  await expect(page.getByText(`Sessão: ${admin}`)).toBeVisible();
}

/** A JPEG drawn by the browser, with an EXIF segment (and a GPS-like marker) spliced in. */
async function jpegWithExif(page: Page): Promise<Buffer> {
  const jpeg = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 800;
    const ctx = c.getContext('2d');
    if (!ctx) return [];
    ctx.fillStyle = '#d33';
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 80px sans-serif';
    ctx.fillText('CARTAZ', 120, 420);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return blob ? [...new Uint8Array(await blob.arrayBuffer())] : [];
  });
  // TIFF header + empty IFD, then the marker the stored file must not contain.
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]),
    Buffer.from('GPSMARCADORDETESTE', 'latin1'),
  ]);
  const len = payload.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]), payload]);
  const bytes = Buffer.from(jpeg);
  return Buffer.concat([bytes.subarray(0, 2), app1, bytes.subarray(2)]);
}

interface PublicEvent {
  title: string;
  poster: { url: string; thumbUrl: string; alt: string | null } | null;
}

test('a poster is sent with the event, waits for moderation, then is public without metadata', async ({
  page,
  request,
}, info) => {
  const project = info.project.name;
  const title = `[Teste] Cartaz ${project} ${Date.now()}`;

  // 1. Add an event with a poster (O quê).
  await page.goto('/');
  await page
    .getByRole('button', { name: /Adicionar evento/ })
    .first()
    .click();
  const flow = page.locator('.add-flow');
  await expect(flow.locator('.detected strong')).toHaveText(/ · /, { timeout: 20_000 });
  await pickPlace(page, flow);
  await flow.getByRole('button', { name: 'Seguinte' }).click();
  await flow.getByText('Concentração', { exact: true }).click();
  await flow.getByLabel('Título').fill(title);
  await flow.getByLabel('Cartaz (opcional)').setInputFiles({
    name: 'cartaz.png',
    mimeType: 'image/png',
    buffer: readFileSync('public/og.png'),
  });
  await expect(flow.getByRole('img', { name: 'Pré-visualização do cartaz' })).toBeVisible();
  await flow
    .getByLabel('Texto do cartaz (opcional)')
    .fill('Concentração de teste, cartaz fictício');
  await shot(page, '15-adicionar-cartaz', project);
  await flow.getByRole('button', { name: 'Seguinte' }).click();
  await flow.getByLabel('Data', { exact: true }).first().fill(dayFromNow(3));
  await flow.getByLabel('Hora de início').first().fill('18:00');
  await sendEvent(flow);
  await expect(flow.getByRole('heading', { name: 'Publicado' })).toBeVisible({ timeout: 30_000 });
  await expect(flow.getByText('O cartaz fica visível depois de verificado')).toBeVisible();
  const editUrl = await flow.getByLabel('Link de edição').inputValue();
  const id = /#e=([0-9A-Z]{26})/.exec(editUrl)?.[1] ?? '';

  // 2. Pending: nothing public.
  const publicEvent = async () =>
    (await (await request.get(`/api/events/${id}`)).json()) as PublicEvent;
  expect((await publicEvent()).poster).toBeNull();

  // 3. The owner replaces it with a photo that carries EXIF (and GPS-like data).
  await page.goto(new URL(editUrl).pathname + new URL(editUrl).hash);
  await expect(page.getByText('A aguardar verificação da moderação.')).toBeVisible();
  await page.getByLabel('Substituir o cartaz').setInputFiles({
    name: 'foto.jpg',
    mimeType: 'image/jpeg',
    buffer: await jpegWithExif(page),
  });
  await page.getByRole('button', { name: 'Enviar cartaz' }).click();
  await expect(page.getByText('Cartaz enviado.')).toBeVisible();
  expect((await publicEvent()).poster).toBeNull();

  // 4. The moderation approves it from the "Cartazes" queue.
  await signIn(page, request, adminFor(project));
  await page.getByRole('button', { name: 'Cartazes' }).click();
  await page.getByLabel('Pesquisar por título ou concelho').fill(title);
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  const card = page.locator(`[data-event-id="${id}"]`);
  await expect(card).toContainText('Cartaz por aprovar');
  await card.getByRole('button', { name: 'Aprovar cartaz' }).click();
  await expect(card).not.toContainText('Cartaz por aprovar');

  // 5. Public now; the stored file is the re-encoded image, without the metadata.
  const poster = (await publicEvent()).poster;
  expect(poster).not.toBeNull();
  const file = await request.get(poster?.url ?? '');
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toMatch(/^image\/(webp|jpeg)$/);
  const stored = (await file.body()).toString('latin1');
  expect(stored).not.toContain('Exif');
  expect(stored).not.toContain('GPSMARCADORDETESTE');

  // 6. The event page: link preview and sheet show the poster.
  const html = await (await request.get(`/mapa/e/${id}`)).text();
  expect(html).toContain(
    `<meta property="og:image" content="${new URL(poster?.url ?? '', page.url()).toString()}">`,
  );
  await page.goto(`/mapa/e/${id}`);
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(title);
  const img = sheet.locator('.event-poster img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  await shot(page, '16-ficha-com-cartaz', project);

  // Phone: the half-height sheet shows a thumbnail, with the date and the
  // actions in view; the full sheet shows the poster large.
  if (project === 'mobile-360') {
    const width = () => img.evaluate((el) => el.getBoundingClientRect().width);
    expect(await width()).toBeLessThanOrEqual(88);
    await expect(sheet.locator('.occ-highlight')).toBeInViewport();
    await expect(sheet.getByRole('button', { name: 'Partilhar' })).toBeInViewport();
    await sheet.getByRole('button', { name: 'Mostrar a ficha toda' }).click();
    await expect.poll(width).toBeGreaterThan(150);
    await shot(page, '17-ficha-com-cartaz-inteira', project);
  }
});
