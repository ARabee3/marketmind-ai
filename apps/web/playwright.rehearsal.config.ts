import { defineConfig, devices } from '@playwright/test'

/**
 * Rehearsal project (IMPLEMENTATION_PLAN_123.md §4.8 H1): drives the REAL
 * NestJS API (:3101) + the Next.js app against a freshly seeded
 * zero-credentials publishing demo. Run only via `npm run demo:rehearse`
 * from the repo root — the orchestration script resets the throwaway test
 * DB first, so this must never run interleaved with the API e2e suite.
 */
export default defineConfig({
  testDir: './e2e/rehearsal',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  outputDir: 'test-results/rehearsal',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Real API on :3101 (dist build produced by the orchestrator, .env.test
      // copied to .env by it; CORS default allows http://localhost:3000).
      command: 'node dist/src/main',
      url: 'http://localhost:3101/api/v1/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../api',
      env: {
        PORT: '3101',
      },
      timeout: 120_000,
    },
    {
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
