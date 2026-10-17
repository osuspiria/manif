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
      proxy: { '/api': 'http://127.0.0.1:8787' },
    },
  },
});
