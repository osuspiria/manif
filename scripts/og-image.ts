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

// Acid theme (src/styles/base.css, docs/decisions.md #70): white, black lines,
// orange accent, square marks, heavy uppercase title.
const html = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; background: #fff; color: #000;
    font-family: 'Archivo', system-ui, sans-serif; }
  .frame { position: absolute; inset: 32px; border: 8px solid #000; display: flex;
    flex-direction: column; justify-content: center; padding: 0 72px; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 40px; background: #ff4d00;
    border-top: 8px solid #000; }
  .title { display: flex; align-items: center; gap: 36px; margin-bottom: 36px; }
  .mark { width: 72px; height: 72px; flex: none; background: #ff4d00; border: 8px solid #000; }
  h1 { font-size: 128px; font-weight: 800; line-height: 1; margin: 0; letter-spacing: -2px;
    text-transform: uppercase; }
  p { font-size: 44px; line-height: 1.25; margin: 0; color: #3d3d3d; max-width: 900px; }
</style></head><body><div class="frame">
  <div class="title"><div class="mark"></div><h1>${esc(pt.site.title)}</h1></div>
  <p>${esc(pt.site.tagline)}</p>
  <div class="bar"></div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();
console.log(`Wrote ${OUT}`);
