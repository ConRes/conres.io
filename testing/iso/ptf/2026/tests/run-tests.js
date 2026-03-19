#!/usr/bin/env node
// @ts-check
/**
 * Test runner for ConRes PDF Test Form Generator
 *
 * Modes:
 *   yarn test                # Run new test files (tests/*.test.js), both implementations
 *   yarn test:legacy         # Run new test files, ONLY legacy implementation tests
 *   yarn test:classes        # Run new test files, ONLY new class implementation tests
 *   yarn test:legacy-intact  # Run archived original tests (tests/legacy/*.test.js)
 *
 * Flags:
 *   --legacy-intact          Discover tests/legacy/*.test.js instead of tests/*.test.js
 *   --generator              Discover tests/generator/*.test.js (memory profiling, etc.)
 *
 * Environment Variables (control skipping WITHIN new test files):
 *   TESTS_ONLY_LEGACY=true   Skip new implementation tests, run only (legacy) tests
 *   TESTS_SKIP_LEGACY=true   Skip (legacy) tests, run only new implementation tests
 *   TESTS_MEMORY=true        Enable memory management tests (skipped by default)
 *   (neither set)            Run both new and legacy implementation tests
 *
 * Note: Environment variables affect which tests run WITHIN the new test files
 * via node:test's native {skip: ...} option. They do NOT affect file discovery.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { glob } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '../../../../..');

const TEST_PORT = 8080;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Parse command line flags
const args = process.argv.slice(2);
const legacyIntactMode = args.includes('--legacy-intact');
const generatorMode = args.includes('--generator');
const fileArgs = args.filter(arg => !arg.startsWith('--'));

console.log('🧪 ConRes PDF Test Form Generator - Test Runner');
console.log('================================================\n');

// Check if http-server is running
async function checkServer() {
    try {
        const response = await fetch(`${BASE_URL}/testing/iso/ptf/2025/index.html`);
        return response.ok;
    } catch {
        return false;
    }
}

async function startServer() {
    console.log('📡 Starting local server on port ' + TEST_PORT + '...');

    const server = spawn('npx', ['http-server', '-d', 'false', '--cors', '-s', '-c-1', '-p', String(TEST_PORT)], {
        cwd: projectRoot,
        stdio: 'pipe',
        shell: true,
        detached: true,
    });

    // Wait for server to be ready
    let attempts = 0;
    while (attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (await checkServer()) {
            console.log('✅ Server started successfully\n');
            return server;
        }
        attempts++;
    }

    throw new Error('Failed to start server after 30 seconds');
}

async function runTests() {
    const serverRunning = await checkServer();
    let server = null;

    if (!serverRunning) {
        server = await startServer();
    } else {
        console.log('✅ Server already running\n');
    }

    console.log('🏃 Running tests...\n');

    // Display mode info
    if (generatorMode) {
        console.log('📌 Mode: Generator Tests (tests/generator/*.test.js)');
        console.log('   TESTS_MEMORY=true  → Enable memory management tests\n');
    } else if (legacyIntactMode) {
        console.log('📌 Mode: Legacy Intact (archived original tests)');
        console.log('   Running tests/legacy/*.test.js unchanged\n');
    } else {
        console.log('📌 Mode: New Test Files (tests/*.test.js)');
        console.log('   Environment variables control test skipping within files:');
        console.log('   TESTS_ONLY_LEGACY=true  → Skip new implementation tests');
        console.log('   TESTS_SKIP_LEGACY=true  → Skip legacy implementation tests\n');
    }

    // Discover test files
    let testFiles;
    if (fileArgs.length > 0) {
        // Specific files provided on command line
        testFiles = fileArgs.map(arg => path.resolve(arg));
    } else if (generatorMode) {
        // Discover tests/generator/*.test.js (memory profiling, etc.)
        testFiles = [];
        for await (const file of glob(path.join(__dirname, 'generator', '*.test.js'))) {
            testFiles.push(file);
        }
    } else if (legacyIntactMode) {
        // Discover tests/legacy/*.test.js (archived original tests)
        testFiles = [];
        for await (const file of glob(path.join(__dirname, 'legacy', '*.test.js'))) {
            testFiles.push(file);
        }
    } else {
        // Discover tests/*.test.js and tests/classes/*.test.js
        // Does NOT discover tests/legacy/*.test.js
        testFiles = [];
        for await (const file of glob(path.join(__dirname, '*.test.js'))) {
            testFiles.push(file);
        }
        for await (const file of glob(path.join(__dirname, 'classes', '*.test.js'))) {
            testFiles.push(file);
        }
    }

    if (testFiles.length === 0) {
        if (legacyIntactMode) {
            console.log('📋 No test files found in tests/legacy/*.test.js\n');
        } else {
            console.log('📋 No test files found in tests/*.test.js');
            console.log('   (New test files will be created in later phases)');
            console.log('   (Use yarn test:legacy-intact to run archived original tests)\n');
        }
        return 0;
    }

    console.log(`📋 Found ${testFiles.length} test file(s): ${testFiles.map((/** @type {string} */ f) => path.basename(f)).join(', ')}\n`);

    return new Promise((resolve, reject) => {
        const testProcess = spawn('node', [
            '--test',
            '--test-reporter=spec',
            // Serialize test file execution to prevent race conditions
            // with shared WASM ColorEngine state across test files
            '--test-concurrency=1',
            ...testFiles,
        ], {
            cwd: projectRoot,
            stdio: 'inherit',
            env: {
                ...process.env,
                BASE_URL,
            },
        });

        testProcess.on('close', (code) => {
            if (server && server.pid) {
                console.log('\n🛑 Stopping server...');
                try {
                    process.kill(-server.pid);
                } catch (e) {
                    // Ignore if process already terminated
                }
            }

            if (code === 0) {
                console.log('\n✅ All tests passed!');
                resolve(code);
            } else {
                console.log(`\n❌ Tests failed with code ${code}`);
                reject(new Error(`Tests failed with code ${code}`));
            }
        });

        testProcess.on('error', (error) => {
            if (server && server.pid) {
                try {
                    process.kill(-server.pid);
                } catch (e) {
                    // Ignore if process already terminated
                }
            }
            reject(error);
        });
    });
}


runTests().catch((error) => {
    console.error(error);
    process.exit(1);
});
