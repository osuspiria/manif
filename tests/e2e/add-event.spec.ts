import { expect, test, type Page } from '@playwright/test';
import { FEATURES } from '../../src/config/app';
import { sendEvent } from './send-event';

/** Local date (Europe/Lisbon ≈ test machine) N days from today, 'YYYY-MM-DD'. */
function dayFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `test-results/screens/${project}-${name}.png` });
}

interface Fc {
  features: { id: string; properties: { title: string; occurrences: { cancelled: boolean }[] } }[];
}

/** Opens the flow and fills steps 1–3; leaves the page on the last step ("Contacto" when the email is on). */
async function fillUntilContact(page: Page, title: string, project: string, screens = false) {
  await page.goto('/');
  await page
    .getByRole('button', { name: /Adicionar evento/ })
    .first()
    .click();

  // 1. Onde — the map centre (mainland) is inside Portugal.
  const flow = page.locator('.add-flow');
  await expect(flow.getByRole('heading', { name: 'Onde' })).toBeVisible();
  await expect(flow.locator('.detected strong')).toHaveText(/ · /, { timeout: 20_000 });
  await flow.getByLabel('Nome do local (opcional)').fill('Praça de teste');
  if (screens) await shot(page, '10-adicionar-onde', project);
  await flow.getByRole('button', { name: 'Seguinte' }).click();

  // 2. O quê
  await expect(flow.getByRole('heading', { name: 'O quê' })).toBeVisible();
  await flow.getByText('Concentração', { exact: true }).click();
  await flow.getByLabel('Título').fill(title);
  await flow.getByLabel('Descrição (opcional)').fill('Evento criado pelos testes e2e.');
  if (screens) await shot(page, '11-adicionar-o-que', project);
  await flow.getByRole('button', { name: 'Seguinte' }).click();

  // 3. Quando — three dates, the 2nd and 3rd copying the time of the previous row.
  await expect(flow.getByRole('heading', { name: 'Quando' })).toBeVisible();
  const dates = flow.getByLabel('Data', { exact: true });
  await dates.nth(0).fill(dayFromNow(3));
  await flow.getByLabel('Hora de início').nth(0).fill('18:00');
  // New events only ask for the start time.
  await expect(flow.getByLabel('Hora de fim (opcional)')).toHaveCount(0);
  await flow.getByRole('button', { name: '+ Adicionar outra data' }).click();
  await dates.nth(1).fill(dayFromNow(10));
  await flow.getByRole('button', { name: '+ Adicionar outra data' }).click();
  await dates.nth(2).fill(dayFromNow(17));
  await expect(flow.getByLabel('Hora de início').nth(2)).toHaveValue('18:00');
  if (screens) await shot(page, '12-adicionar-quando', project);
  if (FEATURES.eventContactEmail) {
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await expect(flow.getByRole('heading', { name: 'Contacto' })).toBeVisible();
  } else {
    // Launch: no email step; "Quando" is the last one (3 of 3).
    await expect(flow.getByText('Passo 3 de 3')).toBeVisible();
    await expect(flow.getByLabel('Email (opcional)')).toHaveCount(0);
  }
  return flow;
}

test.describe('Adicionar e editar evento', () => {
  test('creates an event with 3 dates and shows the secret edit link', async ({
    page,
    request,
  }, info) => {
    const title = `[Teste] Três datas ${info.project.name} ${Date.now()}`;
    const flow = await fillUntilContact(page, title, info.project.name, true);
    if (FEATURES.eventContactEmail) {
      await flow.getByLabel('Email (opcional)').fill('pessoa@exemplo.pt');
    }
    await sendEvent(flow);

    // Turnstile test key (always passes), then the final screen.
    await expect(flow.getByRole('heading', { name: 'Publicado' })).toBeVisible({ timeout: 30_000 });
    const link = await flow.getByLabel('Link de edição').inputValue();
    expect(link).toMatch(/\/editar\/#e=[0-9A-Z]{26}&t=[\w-]{43}$/);
    await shot(page, '13-adicionar-feito', info.project.name);

    const fc = (await (await request.get('/api/events.geojson')).json()) as Fc;
    const created = fc.features.find((f) => f.properties.title === title);
    expect(created?.properties.occurrences).toHaveLength(3);

    // "Ver no mapa" opens the new event's sheet.
    await flow.getByRole('button', { name: 'Ver no mapa' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText(title);
  });

  test('edits through the secret link and cancels one date', async ({ page, request }, info) => {
    const title = `[Teste] Editar ${info.project.name} ${Date.now()}`;
    const res = await request.post('/api/events', {
      headers: { 'CF-Connecting-IP': `203.0.113.${info.project.name === 'desktop' ? 2 : 1}` },
      data: {
        type: 'assembly',
        title,
        lat: 41.1496,
        lng: -8.6109,
        occurrences: [3, 10, 17].map((n) => ({
          localDate: dayFromNow(n),
          startTime: '19:00',
          endTime: null,
          note: null,
        })),
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id, editUrl } = (await res.json()) as { id: string; editUrl: string };

    await page.goto(new URL(editUrl).pathname + new URL(editUrl).hash);
    await expect(page.getByRole('heading', { name: 'Editar evento' })).toBeVisible();
    await expect(page.getByLabel('Título')).toHaveValue(title);
    await page.getByRole('button', { name: 'Cancelar esta data' }).nth(1).click();
    await expect(page.getByText('Cancelada')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar alterações' }).click();
    await expect(page.getByText('Alterações guardadas.')).toBeVisible();
    await shot(page, '14-editar-cancelar-data', info.project.name);

    const event = (await (await request.get(`/api/events/${id}`)).json()) as {
      occurrences: { cancelled: boolean }[];
    };
    expect(event.occurrences.map((o) => o.cancelled)).toEqual([false, true, false]);
  });

  test('warns about an event already at the same place on the same day', async ({
    page,
    request,
  }, info) => {
    // A point of its own per viewport: other tests leave events (some "sem fim",
    // on every date) at the point the fake place search answers.
    const at =
      info.project.name === 'desktop'
        ? { lat: 37.0194, lng: -7.9304 }
        : { lat: 38.5714, lng: -7.9135 };
    await page.route('**/api/geo/search?*', (route) =>
      route.fulfill({ json: [{ label: 'Ponto de teste', ...at }] }),
    );
    const existing = `[Teste] Já no mapa ${info.project.name} ${Date.now()}`;
    const res = await request.post('/api/events', {
      headers: { 'CF-Connecting-IP': `203.0.113.${info.project.name === 'desktop' ? 32 : 31}` },
      data: {
        type: 'rally',
        title: existing,
        ...at,
        occurrences: [{ localDate: dayFromNow(5), startTime: '17:00', endTime: null, note: null }],
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    // Its own client address, so the browser submissions of other tests do not
    // use up this one's rate limit.
    await page.route('**/api/events', (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          'cf-connecting-ip': `203.0.113.${info.project.name === 'desktop' ? 34 : 33}`,
        },
      }),
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: /Adicionar evento/ })
      .first()
      .click();
    const flow = page.locator('.add-flow');
    await flow.getByText('Procurar local').click();
    await flow.getByLabel('Procurar um local ou morada').fill('Ponto');
    await flow.getByRole('button', { name: 'Procurar', exact: true }).click();
    await flow.getByRole('button', { name: 'Ponto de teste' }).click();
    await expect(flow.locator('.detected strong')).toHaveText(
      info.project.name === 'desktop' ? /Faro/ : /Évora/,
      { timeout: 20_000 },
    );
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await flow.getByText('Concentração', { exact: true }).click();
    await flow.getByLabel('Título').fill(`[Teste] Duplicado ${info.project.name} ${Date.now()}`);
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await flow.getByLabel('Data', { exact: true }).fill(dayFromNow(5));
    await flow.getByLabel('Hora de início').fill('18:00');
    if (FEATURES.eventContactEmail) await flow.getByRole('button', { name: 'Seguinte' }).click();

    await flow.getByRole('button', { name: 'Enviar evento' }).click();
    const notice = flow.locator('.duplicates');
    await expect(notice.getByRole('listitem')).toHaveCount(1);
    await expect(notice).toContainText('Este evento pode já estar no mapa');
    const link = notice.getByRole('link', { name: existing });
    await expect(link).toHaveAttribute('href', /^\/mapa\/e\/[0-9A-Z]{26}$/);
    await expect(notice).toBeInViewport();
    await shot(page, '16-adicionar-duplicado', info.project.name);

    // Not a block: sending anyway publishes it.
    await flow.getByRole('button', { name: 'Enviar na mesma' }).click();
    await expect(flow.getByRole('heading', { name: 'Publicado' })).toBeVisible({ timeout: 30_000 });
  });

  test('an invalid edit link shows an error', async ({ page }) => {
    await page.goto('/editar/#e=01JC0000000000000000000ZZZ&t=nope');
    await expect(page.getByRole('alert')).toHaveText(/não é válido/);
  });

  test('a submission that fills the honeypot is blocked', async ({ page, request }, info) => {
    const title = `[Teste] Honeypot ${info.project.name} ${Date.now()}`;
    const flow = await fillUntilContact(page, title, info.project.name);
    // A bot fills every field, including the hidden one.
    await page.locator('#website').evaluate((el: HTMLInputElement) => {
      el.value = 'http://spam.example';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sendEvent(flow);
    await expect(flow.getByRole('alert')).toHaveText('Não foi possível enviar o evento.', {
      timeout: 30_000,
    });
    const fc = (await (await request.get('/api/events.geojson')).json()) as Fc;
    expect(fc.features.some((f) => f.properties.title === title)).toBe(false);
  });

  test('validation errors are shown next to the fields, focus on the first', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: /Adicionar evento/ })
      .first()
      .click();
    const flow = page.locator('.add-flow');
    await expect(flow.locator('.detected strong')).toHaveText(/ · /, { timeout: 20_000 });
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await flow.getByLabel('Título').fill('ab');
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await expect(flow.getByText('Corrige os campos assinalados.')).toBeVisible();
    await expect(flow.getByText('Campo obrigatório.')).toBeVisible();
    await expect(flow.getByLabel('Título')).toHaveAttribute('aria-describedby', 'title-error');
    await expect(flow.getByText('Demasiado curto.')).toBeVisible();
    // Focus goes to the first invalid field (the type radios).
    await expect(page.locator(':focus')).toHaveAttribute('name', 'type');
  });

  test('reports an event from its sheet', async ({ page, request }) => {
    const fc = (await (await request.get('/api/events.geojson')).json()) as Fc;
    const first = fc.features[0];
    await page.goto(`/mapa/e/${first?.id ?? ''}`);
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Reportar' }).click();
    await sheet.getByLabel('Informação errada').check();
    await sheet.getByRole('button', { name: 'Enviar' }).click();
    await expect(sheet.getByText('Obrigado. A moderação vai rever este evento.')).toBeVisible();
  });
});
