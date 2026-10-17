// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// Static site. The API is served by the Worker in src/server; in dev, Vite proxies /api to it.
export default defineConfig({
  output: 'static',
  integrations: [preact()],
  build: { format: 'directory' },
  vite: {
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:8787',
        '/tiles': 'http://127.0.0.1:8787',
      },
    },
    plugins: [
      {
        // In dev, /mapa/e/<id> is served by the static /mapa/ page (in production
        // the Worker does this and injects Open Graph tags).
        name: 'dev-event-pages',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url?.startsWith('/mapa/e/')) {
              const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
              req.url = `/mapa/${query}`;
            }
            next();
          });
        },
      },
    ],
  },
});
