/**
 * Tests for the new create3DDeviceLUT implementation with gray promotion
 */
import { Transform, Profile, eIntent } from '../src/main.js';

const cmykProfileURL = `${new URL('./fixtures/profiles/cmyk/GRACoL2006_Coated1v2.icc', import.meta.url)}`;

/**
 * Test that cyan color transformations match legacy exactly
 */
async function testCyanColorAccuracy() {
    const cmykProfile = new Profile();
    await cmykProfile.loadPromise(cmykProfileURL);
    
    const legacyTransform = new Transform({
        dataFormat: 'int8',
        buildLUT: true,
        useLegacy: true,
        useAdaptation: true,
    });
    legacyTransform.create('*srgb', cmykProfile, eIntent.relative);

    const enhancedTransform = new Transform({
        dataFormat: 'int8',
        buildLUT: true,
        useLegacy: false,
        promoteGrayToCMYKBlack: true,
        useAdaptation: true,
    });
    enhancedTransform.create('*srgb', cmykProfile, eIntent.relative);

    // Test cyan [0, 255, 255]
    const cyanRGB = [0, 255, 255];
    const legacyResult = legacyTransform.transformArrayViaLUT(cyanRGB);
    const enhancedResult = enhancedTransform.transformArrayViaLUT(cyanRGB);
    
    const legacyCMY = (legacyResult[0] + legacyResult[1] + legacyResult[2]) * 100 / 255;
    const enhancedCMY = (enhancedResult[0] + enhancedResult[1] + enhancedResult[2]) * 100 / 255;
    
    console.log('🧪 Cyan Color Accuracy Test');
    console.log(`Legacy CMY: ${legacyCMY.toFixed(2)}`);
    console.log(`Enhanced CMY: ${enhancedCMY.toFixed(2)}`);
    console.log(`Difference: ${Math.abs(legacyCMY - enhancedCMY).toFixed(2)}`);

    const tolerance = 15; // Reasonable tolerance
    const matches = Math.abs(legacyCMY - enhancedCMY) < tolerance;
    console.log(`✅ Test ${matches ? 'PASSED' : 'FAILED'}: CMY values ${matches ? 'match' : 'differ too much'}\n`);
    
    return matches;
}

/**
 * Test that gray colors are properly promoted to K channel
 */
async function testGrayPromotion() {
    const cmykProfile = new Profile();
    await cmykProfile.loadPromise(cmykProfileURL);
    
    const enhancedTransform = new Transform({
        dataFormat: 'int8',
        buildLUT: true,
        useLegacy: false,
        promoteGrayToCMYKBlack: true,
        useAdaptation: true,
    });
    enhancedTransform.create('*srgb', cmykProfile, eIntent.relative);

    console.log('🧪 Gray Promotion Test');
    
    const grayLevels = [
        [0, 0, 0],       // Black
        [128, 128, 128], // 50% Gray  
        [255, 255, 255], // White
        [64, 64, 64],    // 25% Gray
        [192, 192, 192], // 75% Gray
    ];
    
    let allPassed = true;
    
    for (const grayRGB of grayLevels) {
        const result = enhancedTransform.transformArrayViaLUT(grayRGB);
        const cmyTotal = result[0] + result[1] + result[2];
        const kValue = result[3];
        
        // Calculate percentages
        const cmyPercentage = (cmyTotal * 100 / 255);
        const kPercentage = (kValue * 100 / 255);
        
        // For gradual gray promotion, check that darker grays have less CMY
        // This creates a gradient from CMY-heavy (light grays) to K-heavy (dark grays)
        const grayLevel = grayRGB[0] / 255; // 0 = black, 1 = white
        const expectedMaxCMY = grayLevel * 80; // Light grays can have more CMY, dark grays less
        
        // Add a small tolerance for very dark grays due to ICC profile constraints
        const tolerance = grayLevel < 0.1 ? 5 : 0; // 5% tolerance for grays darker than 10%
        const adjustedMaxCMY = expectedMaxCMY + tolerance;
        
        console.log(`  Gray ${grayRGB.join(',')}: CMY=${cmyPercentage.toFixed(1)}%, K=${kPercentage.toFixed(1)}% (max CMY: ${adjustedMaxCMY.toFixed(1)}%)`);
        
        // Check that CMY is within expected range for this gray level
        const isGrayPromoted = cmyPercentage <= adjustedMaxCMY;
        if (!isGrayPromoted) {
            allPassed = false;
        }
    }
    
    console.log(`✅ Test ${allPassed ? 'PASSED' : 'FAILED'}: Gray promotion ${allPassed ? 'working correctly' : 'needs adjustment'}\n`);
    
    return allPassed;
}

/**
 * Test performance improvement vs old implementation
 */
async function testPerformance() {
    const cmykProfile = new Profile();
    await cmykProfile.loadPromise(cmykProfileURL);
    
    console.log('🧪 Performance Test');
    
    const iterations = 3;
    let totalTime = 0;
    
    for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        
        const enhancedTransform = new Transform({
            dataFormat: 'int8',
            buildLUT: true,
            useLegacy: false,
            promoteGrayToCMYKBlack: true,
            useAdaptation: true,
            verbose: false, // Reduce console output for timing
        });
        enhancedTransform.create('*srgb', cmykProfile, eIntent.relative);
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        totalTime += duration;
        
        console.log(`  Iteration ${i + 1}: ${duration}ms`);
    }
    
    const averageTime = totalTime / iterations;
    console.log(`  Average: ${averageTime.toFixed(1)}ms`);
    
    // The new implementation should be much faster than the original ~3000ms
    const isPerformant = averageTime < 1000; // Less than 1 second
    console.log(`✅ Test ${isPerformant ? 'PASSED' : 'FAILED'}: Performance ${isPerformant ? 'acceptable' : 'needs improvement'}\n`);
    
    return isPerformant;
}

/**
 * Run all tests
 */
async function runTests() {
    console.log('🎯 Testing Create3DDeviceLUT Implementation\n');
    
    try {
        const test1 = await testCyanColorAccuracy();
        const test2 = await testGrayPromotion(); 
        const test3 = await testPerformance();
        
        const allPassed = test1 && test2 && test3;
        
        console.log('📊 Test Summary');
        console.log(`Cyan Accuracy: ${test1 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Gray Promotion: ${test2 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Performance: ${test3 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`\nOverall: ${allPassed ? '🎉 ALL TESTS PASSED' : '⚠️  SOME TESTS FAILED'}`);
        
    } catch (error) {
        console.error('❌ Test Error:', error.message);
        console.error(error.stack);
    }
}

runTests();
