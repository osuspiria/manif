// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import { loadEnv } from 'vite';

// Astro loads .env.<mode> for the source code only, not into process.env for this file,
// so read it here (shell variables still win). Mode: --mode, else build → production.
const argv = process.argv;
const mode =
  (argv.includes('--mode') && argv[argv.indexOf('--mode') + 1]) ||
  (argv.includes('build') ? 'production' : 'development');
const env = loadEnv(mode, process.cwd(), '');

// Static site. The API is served by the Worker in src/server; in dev, Vite proxies /api to it.
export default defineConfig({
  output: 'static',
  // Absolute URLs for link previews (og:url, og:image). Set PUBLIC_SITE_URL (.env.production)
  // when building for production, e.g. https://manifesta.pt (decision D2).
  site: env.PUBLIC_SITE_URL || undefined,
  integrations: [preact()],
  // No code blocks in our Markdown; Shiki's inline styles would need 'unsafe-inline'.
  markdown: { syntaxHighlight: false },
  // Content-Security-Policy as a <meta> on every page, with hashes of Astro's own
  // inline scripts/styles. Enforces "no third-party requests except Turnstile"
  // (CLAUDE.md › Privacidade). frame-ancestors goes in public/_headers (not
  // allowed in a <meta>).
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        'frame-src https://challenges.cloudflare.com',
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
      ],
      scriptDirective: { resources: ["'self'", 'https://challenges.cloudflare.com'] },
      styleDirective: { resources: ["'self'"] },
    },
  },
  build: { format: 'directory' },
  vite: {
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:8787',
        '/tiles': 'http://127.0.0.1:8787',
        // District pages (/manifestacoes/…) are served by Astro in dev, without their event list.
        '/sitemap.xml': 'http://127.0.0.1:8787',
      },
    },
    plugins: [
      {
        // In dev, /mapa/e/<id> is served by the static map page (/) and /mapa
        // redirects to it (in production the Worker does both, and injects Open
        // Graph tags into event pages).
        name: 'dev-event-pages',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            if (req.url?.startsWith('/mapa/e/')) {
              req.url = `/${query}`;
            } else if (req.url && /^\/mapa\/?(\?|$)/.test(req.url)) {
              res.writeHead(301, { Location: `/${query}` }).end();
              return;
            }
            next();
          });
        },
      },
    ],
  },
});
