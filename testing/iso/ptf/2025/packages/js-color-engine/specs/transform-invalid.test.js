// @ts-check

import test, { describe } from 'node:test';

/**
 * These should all fail and throw errors
 */

import { Profile, Transform, eIntent, convert as color } from '../src/main.js';

describe('Transform Invalid', () => {

    function incorrectLabInput() {
        const rgb2lab = new Transform();

        rgb2lab.create('*lab', '*srgb', eIntent.absolute);

        const input = color.RGB(200, 150, 50);

        rgb2lab.transform(input);
    }

    test('incorrect Lab Input', ({ assert }) => {
        // expect(incorrectLabInput).toThrow('stage_cmsLab_to_LabD50: input is not of type Lab');
        assert.throws(incorrectLabInput, /\bstage_cmsLab_to_LabD50: input is not of type Lab\b/);
    });

    function inputProfileNotLoaded() {
        const inputProfile = new Profile();
        const testTransform = new Transform();

        testTransform.create(inputProfile, '*lab', eIntent.absolute);
    }


    test('input Profile Not Loaded', ({ assert }) => {
        // expect(inputProfileNotLoaded).toThrow('Profile 1 in chain is not loaded');
        assert.throws(inputProfileNotLoaded, /\bProfile 1 in chain is not loaded\b/);
    });


    function outputProfileNotLoaded() {
        const outputProfile = new Profile();
        const testTransform = new Transform();

        testTransform.create('*lab', outputProfile, eIntent.absolute);
    }

    test('output Profile Not Loaded', ({ assert }) => {
        // expect(outputProfileNotLoaded).toThrow('Profile 2 in chain is not loaded');
        assert.throws(outputProfileNotLoaded, /\bProfile 2 in chain is not loaded\b/);
    });


    function outputProfileNotAProfile() {
        const outputProfile = {};
        const testTransform = new Transform();

        testTransform.create('*lab', outputProfile, eIntent.absolute);
    }

    test('output Profile is not a profile', ({ assert }) => {
        // expect(outputProfileNotAProfile).toThrow('Profile 2 in chain is not a Profile');
        assert.throws(outputProfileNotAProfile, /\bProfile 2 in chain is not a Profile\b/);
    });


    function inputProfileNotAProfile() {
        const inputProfile = {};
        const testTransform = new Transform();

        testTransform.create(inputProfile, '*lab', eIntent.absolute);
    }

    test('input Profile is not a profile', ({ assert }) => {
        // expect(inputProfileNotAProfile).toThrow('Profile 1 in chain is not a Profile');
        assert.throws(inputProfileNotAProfile, /\bProfile 1 in chain is not a Profile\b/);
    });


    function incorrectVirtualProfileString() {
        const testTransform = new Transform();

        testTransform.create('lab', '*lab', eIntent.absolute);
    }

    test('incorrect Virtual Profile String', ({ assert }) => {
        // expect(incorrectVirtualProfileString).toThrow('Profile 1 is a string. Virtual profiles must be prefixed with "*"');
        assert.throws(incorrectVirtualProfileString, /\bProfile 1 is a string. Virtual profiles must be prefixed with "*"/);
    });

    function multiStageNotArray() {
        const testTransform = new Transform();

        testTransform.createMultiStage('*lab', eIntent.absolute);
    }
    test('multiStage Not Array', ({ assert }) => {
        // expect(multiStageNotArray).toThrow('Invalid profileChain, must be an array');
        assert.throws(multiStageNotArray, /\bInvalid profileChain, must be an array\b/);
    });


    function multiStageNoOutputProfile() {
        const testTransform = new Transform();

        testTransform.createMultiStage(['*lab', eIntent.absolute]);
    }

    test('multiStage No Output Profile', ({ assert }) => {
        // expect(multiStageNoOutputProfile).toThrow('Invalid profileChain, must have at least 3 items [profile, intent, profile]');
        assert.throws(multiStageNoOutputProfile, /\bInvalid profileChain, must have at least 3 items \[profile, intent, profile]/);
    });

    function multiStageMissingLastItem() {
        const testTransform = new Transform();

        testTransform.createMultiStage(['*lab', eIntent.absolute, '*srgb', eIntent.absolute]);
    }

    test('multiStage Missing Last Item', ({ assert }) => {
        // expect(multiStageMissingLastItem).toThrow('Last step in chain is not a Profile');
        assert.throws(multiStageMissingLastItem, /\bLast step in chain is not a Profile\b/);
    });

    function intentIsAString() {
        const testTransform = new Transform();

        testTransform.create('*lab', '*srgb', 'absolute');
    }

    test('Intent is a string', ({ assert }) => {
        // expect(intentIsAString).toThrow('Intent 1 in chain is not a number');
        assert.throws(intentIsAString, /\bIntent 1 in chain is not a number\b/);
    });

    function invalidIntent() {
        const testTransform = new Transform();

        testTransform.create('*lab', '*srgb', 9);
    }

    test('Intent is invalid number', ({ assert }) => {
        // expect(invalidIntent).toThrow('Intent 1 in chain is not a valid intent');
        assert.throws(invalidIntent, /\bIntent 1 in chain is not a valid intent\b/);
    });

});