import { expect, test } from '@playwright/test';

for (const path of ['/', '/mapa/']) {
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
      path: testInfo.outputPath(`${path === '/' ? 'home' : 'mapa'}.png`),
      fullPage: true,
    });
  });
}
