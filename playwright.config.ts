import { defineConfig, devices } from '@playwright/test';

// Headless Chromium needs SwiftShader for MapLibre's WebGL.
const launchOptions = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:8787', launchOptions },
  webServer: {
    // Builds, migrates and seeds the LOCAL D1, loads dev tiles into local R2.
    command: 'npm run e2e:server',
    url: 'http://127.0.0.1:8787',
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
