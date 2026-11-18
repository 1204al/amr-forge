import { defineConfig } from '@playwright/test';

const production = process.env.AMR_TEST_BUILD === '1';
const baseURL = production ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173';
const viewport = { width: 1440, height: 1000 };

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 135_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    channel: 'chrome',
    baseURL,
    viewport,
    video: process.env.AMR_RECORD === '1' ? { mode: 'on', size: viewport } : 'off',
  },
  webServer: {
    command: production ? 'npm run preview -- --port 4173 --strictPort' : 'npm run dev -- --port 5173 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
  },
});
