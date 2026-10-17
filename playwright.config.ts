import { defineConfig, devices } from '@playwright/test';

// Headless Chromium needs SwiftShader for MapLibre's WebGL.
const launchOptions = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:8788', launchOptions },
  webServer: {
    // Its own port and local state (.wrangler/e2e), rebuilt on every start: builds,
    // migrates and seeds D1, loads the dev tiles into R2. Never touches `npm run dev`.
    command: 'npm run e2e:server',
    url: 'http://127.0.0.1:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, launchOptions },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
  ],
});
