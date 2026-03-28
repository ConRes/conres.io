import { chromium } from "playwright-chromium";

/** @type {import("playwright-chromium").BrowserServer | undefined} */
let browserServer;

/**
 * Sets up the global test environment for Vitest.
 * Configures NODE_ENV based on build type and launches a Chromium browser server.
 * 
 * @async
 * @param {import("vitest/node").TestProject} config - The test project configuration
 * @returns {Promise<void>} Resolves when setup is complete
 * @throws {Error} If browser server fails to launch
 */
export async function setup({ provide }) {
	process.env.NODE_ENV = process.env.VITE_TEST_BUILD
		? "production"
		: "development";

	browserServer = await chromium.launchServer({
		headless: !process.env.VITE_DEBUG_SERVE,
		args: process.env.CI
			? ["--no-sandbox", "--disable-setuid-sandbox"]
			: undefined,
	});

	provide("wsEndpoint", browserServer.wsEndpoint());
}

export async function teardown() {
	await browserServer?.close();
}
