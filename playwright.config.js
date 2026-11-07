import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

const isWindows = process.platform === 'win32'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  outputDir: 'test-results/miniapp',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4179',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${isWindows ? 'npm.cmd' : 'npm'} run dev -- --host 127.0.0.1 --port 4179 --strictPort`,
    url: 'http://127.0.0.1:4179/miniapp.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
