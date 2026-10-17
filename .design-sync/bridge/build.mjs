// Builds the React-facing bridge (index.ts) into dist/: an ESM bundle with
// Preact and the app code inlined (react stays external), its CSS, and .d.ts.
// Run from the repo root: node .design-sync/bridge/build.mjs
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const deps = join(root, '.ds-sync', 'node_modules');
const req = createRequire(join(deps, 'x.js'));
const esbuild = req('esbuild');

rmSync(join(here, 'dist'), { recursive: true, force: true });

await esbuild.build({
  entryPoints: [join(here, 'index.ts')],
  outfile: join(here, 'dist', 'index.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  external: ['react', 'react-dom'],
  // maplibre is never reached from these components; keep it out if anything pulls it in.
  // Archivo (@fontsource, imported by base.css) is inlined so dist/index.css is self-contained.
  loader: { '.svg': 'text', '.woff2': 'dataurl', '.woff': 'dataurl' },
  logLevel: 'warning',
});

execFileSync(process.execPath, [join(deps, 'typescript', 'bin', 'tsc'), '-p', join(here, 'tsconfig.json')], {
  stdio: 'inherit',
});
writeFileSync(join(here, 'dist', 'index.d.ts'), "export * from './types/.design-sync/bridge/index';\n");
console.log('bridge built: dist/index.mjs, dist/index.css, dist/index.d.ts');
