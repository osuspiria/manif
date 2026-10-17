/**
 * Generates public/og.png (1200×630), the link-preview image, from the app
 * name and tagline in src/i18n/pt.ts. Re-run after changing them (D2):
 *   npm run og:image
 */
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pt } from '../src/i18n/pt';

const OUT = resolve(import.meta.dirname, '../public/og.png');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const html = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; display: flex; align-items: center;
    font-family: system-ui, 'Segoe UI', sans-serif; color: #1a1a1a;
    background: linear-gradient(135deg, #fff 0%, #fff 55%, #fdecea 100%); }
  .wrap { padding: 0 96px; }
  .dot { width: 96px; height: 96px; border-radius: 50%; background: #c62828;
    border: 10px solid #fff; box-shadow: 0 0 0 4px #c62828; margin-bottom: 40px; }
  h1 { font-size: 104px; line-height: 1; margin: 0 0 28px; letter-spacing: -2px; }
  p { font-size: 44px; line-height: 1.25; margin: 0; color: #444; max-width: 900px; }
</style></head><body><div class="wrap">
  <div class="dot"></div>
  <h1>${esc(pt.site.title)}</h1>
  <p>${esc(pt.site.tagline)}</p>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();
console.log(`Wrote ${OUT}`);
