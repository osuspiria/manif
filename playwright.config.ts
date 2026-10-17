import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:8787' },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
