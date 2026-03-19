// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for ConRes PDF Test Form Generator
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './',
    testMatch: '**/*.test.js',
    
    /* Run tests in parallel */
    fullyParallel: true,
    
    /* Fail the build on CI if you accidentally left test.only in the source code */
    forbidOnly: !!process.env.CI,
    
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    
    /* Opt out of parallel tests on CI */
    workers: process.env.CI ? 1 : undefined,
    
    /* Reporter to use */
    reporter: 'html',
    
    /* Shared settings for all the projects below */
    use: {
        /* Base URL for local development server */
        baseURL: 'http://localhost:8080',
        
        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',
        
        /* Take screenshot on failure */
        screenshot: 'only-on-failure',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    /* Run local dev server before starting the tests */
    webServer: {
        command: 'yarn local',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
        cwd: '../../../../', // Root of the workspace
        timeout: 30000,
    },
});
