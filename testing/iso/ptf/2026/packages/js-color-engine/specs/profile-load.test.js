// @ts-check

import test, { describe, before, after } from 'node:test';

/**
 *  Test Loading of ICC profiles
 */

import { Profile } from '../src/main.js';

import http from 'http';
import fs from 'fs';
import url, { fileURLToPath } from 'url';

const testServerPort = 3000;
const realProfileName = 'GRACoL2006_Coated1v2.icc';
const realProfileURL = new URL(`./${realProfileName}`, import.meta.url);
const realProfile = fileURLToPath(realProfileURL);
const nonExistingProfileURL = new URL(`./IDoNotExist.icc`, import.meta.url);
const nonExistingProfile = fileURLToPath(nonExistingProfileURL);
const profileURL = `http://localhost:${testServerPort}/giveMeTheFile`;
const invalidProfileURL = `http://localhost:${testServerPort}/hereBeDragons`;

// const strictEqual = (/** @type {typeof assert.strictEqual} */ (assert.strictEqual));

describe('Profile Loading', () => {

    // Function to create a simple server
    function createServer(port) {
        const server = http.createServer((req, res) => {
            const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`);

            if (parsedUrl.pathname === '/giveMeTheFile') {
                fs.readFile(realProfileURL, (err, data) => {
                    if (err) {
                        res.writeHead(500);
                        res.end('Server Error');
                        return;
                    }
                    res.writeHead(200);
                    res.end(data);
                });
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        server.listen(port);
        //console.log('Server running at http://localhost:' + port +'/');
        return server;
    }

    let server;

    before(() => {
        // Reset the profile before each test
        server = createServer(testServerPort);
    });

    after(() => {
        // Close the server after all tests
        server.close();
        //console.log('Server stopped');
    });

    test('Loading profile from buffer', ({ assert }, done) => {
        const profile = new Profile();
        const buffer = fs.readFileSync(realProfileURL);

        profile.loadBinary(buffer, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });


    test('Loading profile from buffer via generic loader', ({ assert }, done) => {
        const profile = new Profile();
        const buffer = fs.readFileSync(realProfileURL);

        profile.load(buffer, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from base64', ({ assert }, done) => {
        const profile = new Profile();
        const buffer = fs.readFileSync(realProfileURL);
        const base64String = buffer.toString('base64');

        profile.loadBase64(base64String, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from base64 via generic loader', ({ assert }, done) => {
        const profile = new Profile();
        const buffer = fs.readFileSync(realProfileURL);
        const base64String = buffer.toString('base64');

        profile.load(`data:${base64String}`, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from file', ({ assert }, done) => {
        const profile = new Profile();

        profile.loadFile(realProfile, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from file via generic loader', ({ assert }, done) => {
        const profile = new Profile();

        profile.load(realProfileURL, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from file - but not found', ({ assert }, done) => {
        const profile = new Profile();

        profile.loadFile(nonExistingProfile, function (profile) {
            try {
                // expect(profile.loaded).toBe(false);
                // ts-expect-error
                assert.strictEqual(profile.loaded, false);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from url', ({ assert }, done) => {
        const profile = new Profile();

        profile.loadURL(profileURL, function (profile) {
            try {
                // expect(profile.loaded).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loaded, true);

                // expect(profile.name).toBe(realProfileName);
                // ts-expect-error
                assert.strictEqual(profile.name, realProfileName);

                done();
            } catch (error) {
                done(error);
            }
        });
    });

    test('Loading profile from url - but returns 404', ({ assert }, done) => {
        const profile = new Profile();

        profile.loadURL(invalidProfileURL, function (profile) {
            try {
                // expect(profile.loadError).toBe(true);
                // ts-expect-error
                assert.strictEqual(profile.loadError, true);

                // expect(profile.lastError.text).toBe('Response status was 404');
                // ts-expect-error
                assert.strictEqual(profile.lastError.text, 'Response status was 404');

                done();
            } catch (error) {
                done(error);
            }
        });
    });


    test('Loading profile from url (ASYNC)', async ({ assert }) => {
        const profile = new Profile();

        await profile.loadPromise(profileURL);

        // expect(profile.loaded).toBe(true);
        // ts-expect-error
        assert.strictEqual(profile.loaded, true);

        // expect(profile.name).toBe(realProfileName);
        // ts-expect-error
        assert.strictEqual(profile.name, realProfileName);
    });

});