// =====================================================================
// Playwright E2E — smoke test de la app completa
// =====================================================================
// Corre con: npx playwright test
// webServer: http-server en localhost:3100 (sin cache, para ver siempre
// la última versión de los assets).
// =====================================================================
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 30000,
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: 'http://localhost:3100',
        trace: 'on-first-retry'
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: {
        command: 'npx http-server . -p 3100 -c-1',
        url: 'http://localhost:3100',
        reuseExistingServer: !process.env.CI,
        timeout: 30000
    }
});