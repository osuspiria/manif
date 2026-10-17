/**
 * Downloads the Protomaps glyphs (fonts) and sprites we self-host under
 * public/map/. Pinned to a basemaps-assets commit for reproducibility.
 * Only Latin glyph ranges are fetched: labels in Portugal (and neighbouring
 * Spain) are Latin script; other scripts degrade to missing labels.
 *
 * Usage: npm run map:assets
 * (Behind a TLS-intercepting proxy, run with NODE_USE_SYSTEM_CA=1.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const COMMIT = '028c18f713baecad011301ff7a69acc39bcc2ae7';
const BASE = `https://raw.githubusercontent.com/protomaps/basemaps-assets/${COMMIT}`;
const OUT = resolve(import.meta.dirname, '../../../public/map');

const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '512-767', '7680-7935', '8192-8447', '8448-8703'];
const SPRITES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];

async function download(path: string, dest: string): Promise<number> {
  const res = await fetch(`${BASE}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf.length;
}

let total = 0;
for (const font of FONTS) {
  for (const range of RANGES) {
    total += await download(`fonts/${font}/${range}.pbf`, join(OUT, 'fonts', font, `${range}.pbf`));
  }
}
for (const s of SPRITES) {
  total += await download(`sprites/v4/${s}`, join(OUT, 'sprites', s));
}
console.log(`OK: ${(total / 1024).toFixed(0)} KB in ${OUT}`);
