import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for anonshare.dev E2E tests.
 *
 * Runs against the full local stack (web + API + worker + dependencies).
 * In CI the stack is started externally by the workflow before this suite runs.
 * Locally you can run `bun run infra:up && bun run dev` first.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['html', { open: 'never' }]],

  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
