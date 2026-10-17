import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FEATURES } from '../../src/config/app';

/**
 * Phase 7 acceptance (SPEC §9, §10): axe finds no WCAG 2.1 A/AA violations on
 * every page and on the main interactive states; meanwhile no CSP violation
 * happens and the browser requests nothing from third parties (Turnstile is
 * only loaded when a form is sent, which these tests do not do).
 */

async function guard(page: Page) {
  const thirdParty: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !url.protocol.startsWith('data'))
      thirdParty.push(req.url());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return thirdParty;
}

async function check(page: Page, thirdParty: string[], label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(violations, label).toEqual([]);
  const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(csp, `${label}: CSP violations`).toEqual([]);
  expect(thirdParty, `${label}: third-party requests`).toEqual([]);
}

const ALL_PAGES: { path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    path: '/?vista=lista',
    ready: (p) => expect(p.locator('.event-list li').first()).toBeVisible(),
  },
  {
    path: '/',
    ready: async (p) => {
      if ((p.viewportSize()?.width ?? 0) < 900) {
        await p.getByRole('button', { name: 'Mapa', exact: true }).click();
      }
      await expect(p.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    path: '/apoio/',
    ready: async (p) => {
      await expect(p.getByTestId('signature-stats')).toBeVisible();
      await p.getByRole('heading', { name: 'Quem já assinou' }).scrollIntoViewIfNeeded();
      await expect(p.locator('.sig-people li').first()).toBeVisible();
    },
  },
  { path: '/apoio/confirma-email/', ready: (p) => expect(p.locator('h1')).toBeVisible() },
  {
    path: '/apoio/obrigado/',
    ready: (p) => expect(p.getByRole('link', { name: 'WhatsApp' })).toBeVisible(),
  },
  { path: '/apoio/link-invalido/', ready: (p) => expect(p.locator('h1')).toBeVisible() },
  { path: '/apoio/retirar/', ready: (p) => expect(p.getByRole('status')).not.toBeEmpty() },
  {
    path: '/apoio/retirar/#t=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    ready: (p) =>
      expect(p.getByRole('button', { name: 'Retirar a minha assinatura' })).toBeVisible(),
  },
  { path: '/privacidade/', ready: (p) => expect(p.locator('h1')).toBeVisible() },
  {
    path: '/editar/#e=01JC0000000000000000000ZZZ&t=x',
    ready: (p) => expect(p.getByRole('alert')).toBeVisible(),
  },
  {
    path: '/admin/',
    ready: (p) => expect(p.getByRole('heading', { name: 'Entrar na administração' })).toBeVisible(),
  },
  { path: '/admin/entrar/#t=x', ready: (p) => expect(p.getByRole('alert')).toBeVisible() },
  { path: '/esta-pagina-nao-existe', ready: (p) => expect(p.locator('h1')).toBeVisible() },
];

// Pages of switched-off features are not built (src/config/app.ts › FEATURES).
const PAGES = ALL_PAGES.filter(
  ({ path }) =>
    (FEATURES.signatures || !path.startsWith('/apoio')) &&
    (FEATURES.privacyPage || !path.startsWith('/privacidade')),
);

test.describe('Acessibilidade (axe), CSP e pedidos a terceiros', () => {
  for (const { path, ready } of PAGES) {
    test(`page ${path}`, async ({ page }, info) => {
      const thirdParty = await guard(page);
      await page.goto(path);
      await ready(page);
      await check(page, thirdParty, path);
      const slug = path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'inicio';
      await page.screenshot({
        path: `test-results/screens/${info.project.name}-40-${slug.slice(0, 40)}.png`,
        fullPage: true,
      });
    });
  }

  test('event sheet, filters and the "Adicionar evento" steps', async ({ page, request }) => {
    const thirdParty = await guard(page);
    const fc = (await (await request.get('/api/events.geojson')).json()) as {
      features: { id: string }[];
    };
    await page.goto(`/mapa/e/${fc.features[0]?.id ?? ''}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await check(page, thirdParty, 'event sheet');

    await page.goto('/?vista=lista');
    // On the phone the filters open from the summary button; on desktop they are always shown.
    const summary = page.locator('#summary-button');
    if ((page.viewportSize()?.width ?? 0) < 900) {
      await summary.click();
      await expect(summary).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(page.getByRole('group', { name: 'Tipo' })).toBeVisible();
    await check(page, thirdParty, 'filters');

    await page.goto('/?vista=lista');
    await page
      .getByRole('button', { name: /Adicionar evento/ })
      .first()
      .click();
    const flow = page.locator('.add-flow');
    await expect(flow.locator('.detected strong')).toHaveText(/ · /, { timeout: 20_000 });
    await check(page, thirdParty, 'add: onde');
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await flow.getByRole('button', { name: 'Seguinte' }).click();
    await expect(flow.getByText('Corrige os campos assinalados.')).toBeVisible();
    await check(page, thirdParty, 'add: o quê, with errors');
  });

  test('signature form with errors, and the organisation form', async ({ page }) => {
    test.skip(!FEATURES.signatures, 'signatures are switched off');
    const thirdParty = await guard(page);
    await page.goto('/apoio/');
    // Invalid on the client side only: nothing is sent, so Turnstile is not loaded.
    await page.getByText('Por uma organização').click();
    await expect(page.locator('form.form-organization')).toBeVisible();
    await check(page, thirdParty, 'organisation form');
  });
});
