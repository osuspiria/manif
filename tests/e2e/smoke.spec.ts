import { expect, test } from '@playwright/test';

for (const path of ['/']) {
  test(`${path} renders in pt-PT without cookies or third-party requests`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const origin = new URL(baseURL ?? 'http://127.0.0.1:8787').origin;
    const thirdParty: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.protocol.startsWith('http') && url.origin !== origin) thirdParty.push(req.url());
    });

    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
    await expect(page.locator('h1')).toBeVisible();

    expect(await context.cookies()).toEqual([]);
    expect(thirdParty).toEqual([]);

    // No horizontal page scroll.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.screenshot({
      path: testInfo.outputPath('home.png'),
      fullPage: true,
    });
  });
}

test('switched-off features are not reachable or linked (launch configuration)', async ({
  page,
  request,
}) => {
  const { FEATURES } = await import('../../src/config/app');
  test.skip(FEATURES.signatures && FEATURES.privacyPage, 'every feature is on');
  const off = [
    ...(FEATURES.signatures ? [] : ['/apoio/', '/apoio/obrigado/', '/apoio/retirar/']),
    ...(FEATURES.privacyPage ? [] : ['/privacidade/']),
  ];
  for (const path of off) expect((await request.get(path)).status(), path).toBe(404);
  if (!FEATURES.signatures) {
    expect((await request.get('/api/signatures/stats')).status()).toBe(404);
    expect((await request.post('/api/signatures', { data: {} })).status()).toBe(404);
  }
  for (const path of ['/', '/?vista=lista', '/nao-existe']) {
    await page.goto(path);
    for (const target of off) {
      await expect(page.locator(`a[href^="${target}"]`), `${path} → ${target}`).toHaveCount(0);
    }
  }
});
