import { expect, test, type Page } from '@playwright/test';

/** Screenshots for review go to test-results/screens/<project>-<name>.png */
async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `test-results/screens/${project}-${name}.png` });
}

async function waitForMap(page: Page) {
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  // Wait until MapLibre reports the style and tiles are loaded.
  await page.waitForFunction(() => document.querySelector('.maplibregl-canvas') !== null);
  await page.waitForTimeout(2500);
}

const isMobile = (name: string) => name === 'mobile-360';

test.describe('map page (/)', () => {
  test('default view: map, summary, no cookies, no third-party requests', async ({
    page,
    context,
    baseURL,
  }, info) => {
    const origin = new URL(baseURL ?? '').origin;
    const thirdParty: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && u.origin !== origin) thirdParty.push(r.url());
    });

    await page.goto('/');
    await expect(page.getByText(/\d+ eventos · Próximos/).first()).toBeVisible();
    await waitForMap(page);
    await shot(page, '01-mapa', info.project.name);

    expect(await context.cookies()).toEqual([]);
    expect(thirdParty).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('filters: Quando chips update summary and URL; Limpar resets', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByText(/\d+ eventos · Próximos/).first()).toBeVisible();
    if (isMobile(info.project.name)) await page.locator('#summary-button').click();

    const panel = page.locator('#filters');
    await expect(panel).toBeVisible();
    await waitForMap(page);
    await shot(page, '02-filtros', info.project.name);

    await panel.getByRole('button', { name: 'Fim de semana', exact: true }).click();
    await expect(page).toHaveURL(/quando=fds/);
    await expect(page.getByText(/eventos? · Este fim de semana/).first()).toBeVisible();

    await panel.getByRole('button', { name: /Concentração/ }).click();
    await expect(page).toHaveURL(/tipo=rally/);

    await panel.getByRole('button', { name: 'Limpar' }).click();
    await expect(page).not.toHaveURL(/quando=|tipo=/);
  });

  test('"Escolher dia" opens the day strip; empty days are disabled', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByText(/\d+ eventos · Próximos/).first()).toBeVisible();
    if (isMobile(info.project.name)) await page.locator('#summary-button').click();

    await page.getByRole('button', { name: /Escolher dia/ }).click();
    const strip = page.getByRole('group', { name: 'Escolher um dia' });
    await expect(strip).toBeVisible();
    await expect(strip.locator('button')).toHaveCount(60);
    expect(await strip.locator('button:disabled').count()).toBeGreaterThan(0);

    const firstEnabled = strip.locator('button:not(:disabled)').first();
    await firstEnabled.click();
    await expect(page).toHaveURL(/dia=\d{4}-\d{2}-\d{2}/);
    await waitForMap(page);
    await shot(page, '03-escolher-dia', info.project.name);
  });

  test('list view groups by day and opens a multi-date event', async ({ page }, info) => {
    await page.goto('/?vista=lista');
    const list = page.locator('.event-list');
    await expect(list).toBeVisible();
    await expect(list.locator('h2').first()).toHaveText(/^\p{Lu}[\p{L}-]+, \d{1,2} \p{L}{3}$/u);
    await shot(page, '04-lista', info.project.name);

    // A weekly series from the seed.
    await list
      .getByRole('button', { name: /Assembleia aberta semanal do bairro/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(/Assembleia aberta semanal/);
    await expect(page).toHaveURL(/\/mapa\/e\/[0-9A-Z]{26}/);
    await sheet.getByRole('button', { name: /outras datas/ }).click();
    await expect(sheet.locator('#event-other-dates li')).not.toHaveCount(0);
    await shot(page, '05-evento-varias-datas', info.project.name);
  });

  test('popup from the map view with several dates', async ({ page }, info) => {
    await page.goto('/');
    await waitForMap(page);
    // Open via the list on mobile is covered above; here use a deep link with the map visible.
    const res = await page.request.get('/api/events.geojson');
    const fc = (await res.json()) as {
      features: { id: string; properties: { title: string; occurrences: unknown[] } }[];
    };
    const multi = fc.features.find((f) =>
      f.properties.title.includes('Desfile na Avenida dos Aliados'),
    );
    expect(multi).toBeDefined();
    await page.goto(`/mapa/e/${multi?.id ?? ''}`);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(/Aliados/);
    await expect(sheet.getByText(/\+ \d+ outras? datas?/)).toBeVisible();
    await waitForMap(page);
    await shot(page, '06-popup-mapa', info.project.name);
  });

  test('the map is the home page; old /mapa links redirect with their filters', async ({
    page,
  }) => {
    await page.goto('/mapa?quando=hoje');
    await expect(page).toHaveURL(/\/\?quando=hoje$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mobilização' })).toBeVisible();
  });

  test('the intro makes room for the filters and the event sheet on a phone', async ({
    page,
  }, info) => {
    test.skip(!isMobile(info.project.name), 'phone layout only');
    await page.goto('/?vista=lista');
    const intro = page.locator('.map-app .map-intro');
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('Manifestações, concentrações e assembleias');
    await expect(intro).toContainText(
      'não tem qualquer ligação ao Presidente da Câmara Municipal do Porto',
    );
    await shot(page, '00-intro', info.project.name);

    await page.locator('#summary-button').click();
    await expect(page.locator('#filters')).toBeVisible();
    await expect(intro).toBeHidden();
    // The h1 stays for screen readers.
    await expect(page.getByRole('heading', { level: 1, name: 'Mobilização' })).toBeAttached();

    // Choosing an event closes the filters.
    await page.getByRole('button', { name: 'Ver resultados' }).click();
    await expect(intro).toBeVisible();
    await page.locator('.event-card').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(intro).toBeHidden();

    // Opening the filters closes the event.
    await page.locator('#summary-button').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#filters')).toBeVisible();
  });

  test('URL state is restored on load', async ({ page }, info) => {
    await page.goto('/?quando=hoje&tipo=rally,assembly');
    if (isMobile(info.project.name)) await page.locator('#summary-button').click();
    const panel = page.locator('#filters');
    await expect(panel.getByRole('button', { name: 'Hoje', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(panel.getByRole('button', { name: /Concentração/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(panel.getByRole('button', { name: /Assembleia/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(/· Hoje · 2 tipos/).first()).toBeVisible();
  });

  test('share page has Open Graph tags', async ({ page, request }) => {
    const fc = (await (await request.get('/api/events.geojson')).json()) as {
      features: { id: string; properties: { title: string } }[];
    };
    const first = fc.features[0];
    expect(first).toBeDefined();
    const html = await (await request.get(`/mapa/e/${first?.id ?? ''}`)).text();
    expect(html).toContain('property="og:title"');
    await page.goto(`/mapa/e/${first?.id ?? ''}`);
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
