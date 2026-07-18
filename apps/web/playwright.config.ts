import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      command: 'node e2e/support/session-server.mjs',
      url: 'http://localhost:3101/health',
      reuseExistingServer: !process.env.CI,
      cwd: '.',
    },
    {
      // CI runs the production build to avoid React Strict Mode double-mounts
      // that would duplicate GET /status calls in the dev server. Local runs keep
      // the fast dev server for iterative debugging.
      command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      cwd: '.',
      env: {
        NEXT_PUBLIC_API_URL: 'http://localhost:3101/api/v1',
      },
      timeout: process.env.CI ? 300_000 : 120_000,
    },
  ],
})
