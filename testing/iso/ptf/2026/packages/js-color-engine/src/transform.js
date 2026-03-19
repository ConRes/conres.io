/**
 * @fileoverview Color transformation engine for ICC profile-based color conversions
 * Handles complex color transformations between different color spaces using ICC profiles
 * Supports multi-stage transformations, LUT optimization, and various data formats
 * 
 * @license GPL-3.0-or-later
 * @copyright 2019, 2024 Glenn Wilton, O2 Creative Limited
 */

// @ts-check

import { Profile } from './profile.js';
import convert from './convert.js';

import {
    eColourType, eIntent, eProfileType, eProfileTypeToString,
    illuminants, encoding, encodingStr, u1Fixed15NumberMax, roundN,
    uint8ArrayToBase64, uint16ArrayToBase64, base64ToUint8Array, base64ToUint16Array,
    intent2String,
} from './def.js';
import { LookupTable as LookupTableClass, create3DDeviceLUT, create4DDeviceLUT } from './lut.js';
import {
    getLut_legacy,
    getLut16_legacy,
    getLut8_legacy,
    setLut_legacy,
    cloneLut_legacy,
    create1DDeviceLUT_legacy,
    create2DDeviceLUT_legacy,
    create3DDeviceLUT_legacy,
    create4DDeviceLUT_legacy
} from './legacy/lut.js';
import {
    linearInterp1D_NCh,
    bilinearInterp2D_NCh,
    tetrahedralInterp3D_NCh,
    trilinearInterp3D_NCh,
    tetrahedralInterp3D_3Ch,
    tetrahedralInterp3D_4Ch,
    tetrahedralInterp3D_3or4Ch,
    linearInterp1DArray_NCh_loop,
    tetrahedralInterp3DArray_NCh_loop,
    tetrahedralInterp4D_3Ch,
    tetrahedralInterp4D_4Ch,
    tetrahedralInterp4D_NCh,
    trilinearInterp3D_3or4Ch,
    trilinearInterp4D_3or4Ch,
    tetrahedralInterp3D_Master,
    tetrahedralInterp4D_3or4Ch_Master,
} from './interpolation.js';
import {
    trilinearInterp3D_NCh_legacy,
    tetrahedralInterp3D_3Ch_legacy,
    tetrahedralInterp3D_4Ch_legacy,
    tetrahedralInterp3D_3or4Ch_legacy,
    linearInterp1D_NCh_legacy,
    bilinearInterp2D_NCh_legacy
} from './legacy/interpolation.js';
import {
    applyBlackpointCompensation,
    estimateNearlyStraightMidRangeBlackpointR2 as estimateNearlyStraightMidRangeBlackpoint,
    estimateBlackpoint,
} from './blackpoint-estimation.js';

/**
 * @typedef {{PCSDecode: number, PCS8BitScale: number, viewingConditions: string | object, whitePoint, PCSEncode: number, name, header, description, type, intent, version, mediaWhitePoint}} ProfileObject
 */

/**
 * @typedef {object} TransformOptions
 * @property {boolean} [buildLUT=false] - Precompute LUT for faster conversion
 * @property {number} [lutGridPoints3D=33] - Grid points for 3D LUTs (17, 33, or 65)
 * @property {number} [lutGridPoints4D=17] - Grid points for 4D LUTs (11, 17, or 33)
 * @property {boolean} [interpolationFast] - Use faster interpolation (less accurate)
 * @property {string} [interpolation='tetrahedral'|'trilinear'] - 3D/4D pipeline interpolation
 * @property {string} [interpolation3D='tetrahedral'|'trilinear'] - 3D pipeline interpolation
 * @property {string} [interpolation4D='tetrahedral'|'trilinear'] - 4D pipeline interpolation
 * @property {string} [LUTinterpolation='tetrahedral'|'trilinear'] - 3D/4D LUT interpolation method
 * @property {string} [LUTinterpolation3D='tetrahedral'|'trilinear'] - 3D LUT interpolation method
 * @property {string} [LUTinterpolation4D='tetrahedral'|'trilinear'] - 4D LUT interpolation method
 * @property {'object'|'objectFloat'|'int8'|'int16'|'device'} [dataFormat='object'] - Data format: 'object', 'objectFloat', 'int8', 'int16', 'device'
 * @property {boolean} [useFloats] - Obsolete, use dataFormat instead
 * @property {boolean} [useAdaptation]
 * @property {boolean} [xxuseBPC]
 * @property {boolean|boolean[]} [BPC]
 * @property {boolean} [_BPCAutoEnable] - Obsolete, use autoEnableBPC instead
 * @property {boolean} [autoEnableBPC] - Automatically enable BPC if needed
 * @property {boolean} [labInputAdaptation=false] - Adapt input Lab colors to D50 white point
 * @property {boolean} [labAdaptation=false] - Adapt Lab colors to D50 white point
 * @property {boolean} [displayChromaticAdaptation=true] - Apply chromatic adaptation
 * @property {boolean} [pipelineDebug=false] - Enable pipeline debugging
 * @property {boolean} [optimize=true] - Optimize pipeline to remove unnecessary conversions
 * @property {boolean} [verbose=false] - Enable verbose logging
 * @property {boolean} [verboseTiming=false] - Enable verbose timing information
 * @property {boolean} [clipRGBinPipeline=false] - Enable RGB clipping in the pipeline
 * @property {boolean} [roundOutput=false] - Round output to specified precision
 * @property {number} [precision=0] - Decimal places for rounding
 * @property {boolean|boolean[]} [BPC=false] - Black Point Compensation settings
 * @property {boolean} [useLegacy=false] - Use legacy LUT implementation for backward compatibility
 * @property {boolean} [useLegacyInterpolation=false] - Use legacy interpolation implementations for backward compatibility
 * @property {boolean} [promoteGrayToCMYKBlack=false] - Promote gray values to CMYK black channel
 * @property {Record<string, *>} [debugging] - Debugging options
 */

/**
 * @typedef {object} _Stage
 * @property {string} stageName - Stage name/identifier
 * @property {string} [type] - Stage type (e.g., 'matrix', 'lut', 'adaptation')
 * @property {Function} [fn] - Transform function to execute
 * @property {object} [data] - Stage-specific data
 * @property {string} [description] - Human-readable description
 * @property {function} [funct] - Custom function for this stage
 * @property {object} stageData - Custom data for this stage
 * @property {encoding | false} [inputEncoding] - Input encoding type
 * @property {encoding | false} [outputEncoding] - Output encoding type
 * @property {string} [debugFormat] - Debug format string
 * @property {boolean} [optimized] - Whether the stage is optimized
 */

/**
 * @typedef {object} CustomStage
 * @property {string} name - Custom stage name
 * @property {PipelinePosition} position - Pipeline position: 'beforeInput2Device', 'beforeDevice2PCS', etc.
 * @property {Function} stageFn - Custom transformation function
 * @property {object} stageData - Custom data for this stage
 * @property {object} [data] - Stage-specific data
 * @property {PipelinePosition} [location] - Location in the pipeline
 * @property {string} [description] - Human-readable description
 */

/**
 * @typedef {object} LookupTable
 * @property {number[]} CLUT - Color lookup table data
 * @property {number} inputChannels - Number of input channels (3 or 4)
 * @property {number} outputChannels - Number of output channels (3 or 4)
 * @property {number} gridPoints - Number of grid points per dimension
 * @property {string} interpolation - Interpolation method used
 * @property {object} [metadata] - Additional LUT metadata
 */

/**
 * @typedef {'beforeInput2Device'|'beforeDevice2PCS'|'afterDevice2PCS'|'PCS'|'beforePCS2Device'|'afterPCS2Device'|'afterDevice2Output'} PipelinePosition
 */

/**
 * Color transformation class for converting colors between different color spaces.
 * 
 * Supports single and multi-stage transformations using ICC profiles or virtual profiles.
 * 
 * Custom stages can be inserted at various points in the transformation pipeline:
 * 
 * - 'beforeInput2Device' - Before input profile processing
 * - 'beforeDevice2PCS' - Before device to PCS conversion
 * - 'afterDevice2PCS' - After device to PCS conversion
 * - 'PCS' - In the Profile Connection Space
 * - 'beforePCS2Device' - Before PCS to device conversion
 * - 'afterPCS2Device' - After PCS to device conversion
 * - 'afterDevice2Output' - After output profile processing
 * 
 * Data format options:
 * 
 * - 'object': Structured format {type: eColourType, R:0, G:0, B:0}
 * - 'objectFloat': Same as object but with floats (0.0-1.0)
 * - 'int8': 8-bit integer array (0-255)
 * - 'int16': 16-bit integer array (0-65535)
 * - 'device': n-Channel floats array (0.0-1.0)
 */
export class Transform {
    /** @param {TransformOptions} [options] - Configuration options for the transformation */
    constructor(options) {

        options = options || {};

        /** Whether to build a precomputed LUT for faster transformations */
        // this.buildLUT = options.buildLUT === true;
        this.buildLUT = Boolean(options.buildLUT);

        /** Whether to use legacy LUT implementation for backward compatibility */
        this.useLegacy = Boolean(options.useLegacy);

        /** Whether to use legacy interpolation implementations for backward compatibility */
        this.useLegacyInterpolation = Boolean(options.useLegacyInterpolation);

        /** CMYK processing option: Promote gray values to CMYK black channel */
        this.promoteGrayToCMYKBlack = Boolean(options.promoteGrayToCMYKBlack);

        /** Dedicated LookupTable instance for new implementation */
        this.lookupTable = null;

        /** Number of grid points for 3D LUTs (17, 33, or 65) */
        this.lutGridPoints3D = (isNaN(Number(options.lutGridPoints3D))) ? 33 : Number(options.lutGridPoints3D);
        this.lutGridPoints4D = (isNaN(Number(options.lutGridPoints4D))) ? 17 : Number(options.lutGridPoints4D);

        this.interpolation3D = options.interpolation3D ? options.interpolation3D.toLowerCase() : 'tetrahedral';
        this.interpolation4D = options.interpolation4D ? options.interpolation4D.toLowerCase() : 'tetrahedral';
        // this.interpolationFast = options.interpolationFast !== false;
        this.interpolationFast = Boolean(options.interpolationFast);

        this.LUTinterpolation3D = options.LUTinterpolation3D?.toLocaleLowerCase?.() ?? options.LUTinterpolation?.toLocaleLowerCase?.() ?? this.interpolation3D;
        this.LUTinterpolation4D = options.LUTinterpolation4D?.toLocaleLowerCase?.() ?? options.LUTinterpolation?.toLocaleLowerCase?.() ?? this.interpolation4D;

        // this.labAdaptation = options.labAdaptation === true;
        this.labAdaptation = Boolean(options.labAdaptation);
        // this.displayChromaticAdaptation = options.displayChromaticAdaptation === true;
        this.displayChromaticAdaptation = Boolean(options.displayChromaticAdaptation);
        this.labInputAdaptation = options.labInputAdaptation !== false;

        /** @type {TransformOptions['dataFormat']} */
        this.dataFormat = options.dataFormat || 'object'; // object, objectFloat, int8, int16, device

        if (!options.dataFormat) {
            // Obsolete, use dataFormat instead
            if (options.useFloats) {
                console.log('useFloats is obsolete, use dataFormat instead');
                this.dataFormat = 'objectFloat';
            }
        }

        var convertInputOutput = true;
        switch (this.dataFormat) {
            case 'object':
                convertInputOutput = true;
                break;
            case 'objectFloat':
                convertInputOutput = true;
                this.useFloats = true; // backwards compatibility
                break;
            case 'int8':
            case 'int16':
                convertInputOutput = true;
                break;
            case 'device':
                convertInputOutput = false;
                break;
            default:
                throw new Error('Invalid dataFormat "' + this.dataFormat + '". Must be "object", "objectFloat", "int8", "int16" or "device"');
        }

        this.convertInputOutput = convertInputOutput;
        // this.verbose = options.verbose === true;
        this.verbose = Boolean(options.verbose);
        // this.verboseTiming = options.verboseTiming === true;
        this.verboseTiming = Boolean(options.verboseTiming);
        // this.pipelineDebug = options.pipelineDebug === true;
        this.pipelineDebug = Boolean(options.pipelineDebug);
        this.optimize = options.optimize !== false;
        this.optimizeDebug = [];
        this.roundOutput = options.roundOutput !== false;
        this.precision = (isNaN(Number(options.precision))) ? 0 : Number(options.precision);

        if (Array.isArray(options.BPC)) {
            this.useBPC = options.BPC; // can use an array to specify which channels to which stage
        } else {
            this.useBPC = options.BPC === true; // defaults to off
            // this.useBPC = options.BPC != null ? Boolean(options.BPC) : options.useBPC ?? false;
        }

        this._BPCAutoEnable = options.autoEnableBPC ?? true;
        this.usesBPC = false;
        this.usesAdaptation = false;
        this._expandRGBStages = true;
        this._RGBMatrixWhiteAdadaptation = false;
        this.clipRGBinPipeline = options.clipRGBinPipeline === true;

        /** @type {_Stage[]}  */
        this.pipeline = [];

        this.pipelineHistory = [];
        this.pipelineCreated = false;
        this.debugHistory = [];
        this.debugHistoryDecimals = 6;
        /** @type {import('./decode.js').LUT | false} */
        this.lut = false;
        /** @type {Profile?} */
        this.inputProfile = null;
        /** @type {Profile?} */
        this.outputProfile = null;
        /** @type {(Profile|eIntent)[]} */
        this.chain = [];
        /** @type {CustomStage[] | false} */
        this.customStages = false;

        this.inputChannels = 0;
        this.outputChannels = 0;

        this.debugging = options.debugging || {};
    };


    /**
     * Gets the prebuilt lookup table with optional precision rounding
     * The LUT can be used in future transformations instead of using profiles for better performance
     * @param {number} [precision] - Number of decimal places to round LUT values to (for smaller JSON output)
     */
    getLut(precision) {
        if (this.useLegacy) {
            return getLut_legacy(this, precision);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.getLut(precision);
        }

        // Fallback to legacy behavior if no lookupTable exists
        return getLut_legacy(this, precision);
    }

    /**
     * Gets the prebuilt lookup table as 16-bit integers
     * Converts floating-point LUT values to 16-bit integer representation (0-65535)
     * Used for ICC profile generation or systems that require integer LUT data
     */
    getLut16() {
        if (this.useLegacy) {
            return getLut16_legacy(this);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.getLut16();
        }

        // Fallback to legacy behavior if no lookupTable exists
        return getLut16_legacy(this);
    }

    /**
     * Get the prebuilt lut - which can be used in future instead of using profiles, This is going to be low fidelity as we are only using 8bit
     * @returns 8-bit lookup table for low fidelity color transformations
     */
    getLut8() {
        if (this.useLegacy) {
            return getLut8_legacy(this);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.getLut8();
        }

        // Fallback to legacy behavior if no lookupTable exists
        return getLut8_legacy(this);
    }

    /**
     * Set a prebuilt lut - which can be used instead of using profiles
     * @param {import('./decode.js').LUT} lut
     */
    setLut(lut) {
        if (this.useLegacy) {
            return setLut_legacy(this, lut);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.setLut(lut);
        }

        // Fallback to legacy behavior if no lookupTable exists
        return setLut_legacy(this, lut);
    }

    cloneLut(CLUT, encoding) {
        if (this.useLegacy) {
            return cloneLut_legacy(this, CLUT, encoding);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.cloneLut(CLUT, encoding);
        }

        // Fallback to legacy behavior if no lookupTable exists
        return cloneLut_legacy(this, CLUT, encoding);
    }

    /**
     * Creates a transformation pipeline between two ICC profiles.
     * 
     * This is the main function for creating a transform from two profiles. It will build
     * a pipeline of stages to convert from one profile to another, and then optimize the pipeline.
     * 
     * @param {import('./profile.js').NamedProfile|Profile} inputProfile - Source color profile (Profile instance or virtual profile name)
     * @param {import('./profile.js').NamedProfile|Profile} outputProfile - Destination color profile (Profile instance or virtual profile name)
     * @param {eIntent} intent - Rendering intent for the transformation
     * @param {CustomStage[]} [customStages] - Optional custom transformation stages to insert
     */
    create(inputProfile, outputProfile, intent, customStages) {
        return this.createMultiStage([inputProfile, intent, outputProfile], customStages);
    }

    /**
     * This is the main function for creating a transform from two OR MORE profiles, It will build the entire pipeline.
     *
     * For example if you want to create a proofing profile to simulate CMYK printing, you would pass in the following
     * profiles in order:
     * 
     *     profileChain = [
     *       profile,
     *       intent,
     *       profile,
     *       intent,
     *       profile,
     *       {inputProfile: '*sRGB', outputProfile: CMYKProfile, intent: eIntent.perceptual, customStages: []},
     *       {inputProfile: CMYKProfile, outputProfile: '*sRGB', intent: eIntent.relative},
     *     ]
     *
     * If you wanted to know if a lab value is converted to RGB, printed in CMYK what is the final lab value
     * to calculate a DeltaE:
     *
     *     profileChain = [ '*lab', eIntent.relative,  '*sRGB']
     * 
     *     profileChain = [ '*sRGB', eIntent.perceptual,CMYKProfile ],
     * 
     *     profileChain = [ CMYKProfile, '*lab', eIntent.absolute ],
     *
     * @param {(import('./profile.js').NamedProfile|Profile|eIntent)[]} sourceProfileChain
     * @param {CustomStage[]} [customStages]
     */
    createMultiStage(sourceProfileChain, customStages) {
        customStages = customStages || [];

        if (!Array.isArray(sourceProfileChain))
            throw new Error('Invalid profileChain, must be an array');

        /** @type {(Profile | eIntent)[]} */
        const profileChain = new Array(sourceProfileChain.length);
        var step, i;
        var chainEnd = profileChain.length - 1;

        // Create Virtual profiles
        // This makes it easier to just create a transform from a profile name
        // and not have to worry about loading the profile
        var profileIndex = 1;
        var intentIndex = 1;
        for (let i = 0; i < sourceProfileChain.length; i++) {
            step = sourceProfileChain[i];
            if (i % 2 === 0) {
                // Profiles are only even numbers 0,2,4,6 etc
                if (typeof step === 'string') {
                    if (step.substring(0, 1) === '*') {
                        // automatically create virtual profile
                        profileChain[i] = new Profile(step);
                        profileIndex++;
                        continue;
                    } else {
                        throw new Error('Profile ' + profileIndex + ' is a string. Virtual profiles must be prefixed with "*"');
                    }
                }
            }
            profileChain[i] = /** @type {Profile|eIntent} */(step);
        }

        this.inputProfile = null;
        this.outputProfile = null;
        this.usesBPC = false;
        this.usesAdaptation = false;

        // console.log('createMultiStage:', { profileChain });

        if (this.lut === false) {
            // validate input and output profiles
            if (!Array.isArray(profileChain)) {
                throw new Error('Invalid profileChain, must be an array');
            }

            if (profileChain.length < 3) {
                throw new Error('Invalid profileChain, must have at least 3 items [profile, intent, profile]');
            }

            profileIndex = 1;
            intentIndex = 1;
            for (let i = 0; i < profileChain.length; i++) {
                step = profileChain[i];

                if (i % 2 === 0) {
                    // profile

                    if (!(step instanceof Profile)) {
                        throw new Error('Profile ' + profileIndex + ' in chain is not a Profile');
                    }

                    if (!step.loaded) {
                        throw new Error('Profile ' + profileIndex + ' in chain is not loaded');
                    }

                    profileIndex++;
                } else {
                    // intent
                    if (typeof step !== 'number') {
                        throw new Error('Intent ' + intentIndex + ' in chain is not a number');
                    }

                    if (!(step === eIntent.absolute ||
                        step === eIntent.perceptual ||
                        step === eIntent.relative ||
                        step === eIntent.saturation
                    )) {
                        throw new Error('Intent ' + intentIndex + ' in chain is not a valid intent');
                    }
                    intentIndex++;
                }
            }

            if (!(profileChain[0] instanceof Profile)) {
                throw new Error('First step in chain is not a Profile');
            }

            if (!(profileChain[chainEnd] instanceof Profile)) {
                throw new Error('Last step in chain is not a Profile');
            }

        } else {
            if (!this.lut || this.lut.CLUT === undefined || this.lut.CLUT === null) {
                throw new Error('Invalid LUT');
            }
        }


        //
        // Save the profile chain, so we can see how this pipeline was created
        //
        this.chain = /** @type {(Profile | eIntent)[]} */(profileChain);

        // Note that even though we might have 3 or 4 profiles, we want to
        // save the initial input and output profiles for quick access as these contain
        // info about the input and output colour spaces, the other profiles are just used for conversion
        this.inputProfile = /** @type {Profile} */(profileChain[0]);
        this.inputChannels = this.getProfileChannels(this.inputProfile);

        this.outputProfile = /** @type {Profile} */(profileChain[chainEnd]);
        this.outputChannels = this.getProfileChannels(this.outputProfile);

        this.customStages = customStages;

        // Built lut or if lut pre-supplied use it
        if (this.buildLUT || this.lut !== false) {
            //
            // Prebuilt luts are faster as they only need 1-2 stages, but they are less accurate
            // and take time to compute, but for  images they are a much better option
            // where speed is more important than accuracy, especially in 8bit
            //

            if (this.lut === false) {
                // create temporary pipeline for building LUT, we do not convert input or output as we
                // want the lut to be device encoding 0.0-1.0 end to end, This makes is easier to
                // use the lut in future with any input or output data
                this.createPipeline(profileChain, false, false, false);

                if (this.verbose) {

                    if (this.optimize) {
                        console.log(this.optimizeInfo());
                    } else {
                        console.log(this.getStageNames(false, false));
                    }

                    console.log('Temp Pipeline Created, Building LUT ....');
                }

                this.pipelineCreated = true;

                // create the prebuilt Lut
                this.lut = this.createLut();
                // console.dir({profileChain, lut: this.lut}, {depth: 3, compact: true, maxArrayLength: 9});
            } else {
                if (this.verbose) {
                    console.log('Using prebuilt LUT...');
                }
            }

            // rebuild pipeline to use LUT and the LUTinterpolation method, seriously just stay with tetrahedral
            const defaultInterpolation3D = this.interpolation3D;
            const defaultInterpolation4D = this.interpolation4D;

            const lutInterpolation3D = this.interpolation3D = this.LUTinterpolation3D;
            const lutInterpolation4D = this.interpolation4D = this.LUTinterpolation4D;

            this.createPipeline(profileChain, this.convertInputOutput, this.convertInputOutput, true);

            if (this.verbose) {
                console.log('Pipeline created with LUT interpolation:', {
                    defaultInterpolation3D,
                    defaultInterpolation4D,
                    lutInterpolation3D,
                    lutInterpolation4D
                });
            }

            // restore interpolation
            this.interpolation3D = defaultInterpolation3D;
            this.interpolation4D = defaultInterpolation4D;

        } else {
            // standard pipeline wihtout a prebuilt lut
            if (this.verbose) {
                console.log('Creating standard pipeline without prebuilt LUT...');
            }
            this.createPipeline(profileChain, this.convertInputOutput, this.convertInputOutput, false);
            this.lut = false;
        }

        this.pipelineCreated = true;

        if (this.verbose) {
            if (this.optimize) {
                console.log(this.optimizeInfo());
            } else {
                console.log(this.getStageNames(false, false));
            }
        }
    };

    /**
     * Creates a prebuilt LUT from the current pipeline. This LUT is compatible with ICCProfile
     * LUT structure, and so can be used in the same trilinear/tetrahedral stages
     *
     * @returns {import('./decode.js').LUT}
     */
    createLut() {
        if (this.verboseTiming) {
            console.time('create Prebuilt Lut');
        }
        var CLUT;
        var gridPoints;
        var inputChannels;
        var outputChannels;

        switch (this.outputProfile?.type) {

            case eProfileType.Gray:
                outputChannels = 1;
                break;
            case eProfileType.Duo:
                outputChannels = 2;
                break;
            case eProfileType.Lab:
            case eProfileType.RGBMatrix:
            case eProfileType.RGBLut:
                outputChannels = 3;
                break;
            case eProfileType.CMYK:
                outputChannels = 4;
                break;
            default:
                throw new TypeError(`Create Lut Invalid output profile type ${this.outputProfile?.type}`);
        }

        switch (this.inputProfile?.type) {
            case eProfileType.Gray:
                inputChannels = 1;
                if (this.useLegacy) {
                    CLUT = this.create1DDeviceLUT(outputChannels, this.lutGridPoints3D);
                } else {
                    // Use new LookupTable for 1D (not yet implemented in LookupTable class)
                    CLUT = this.create1DDeviceLUT(outputChannels, this.lutGridPoints3D);
                }
                gridPoints = [this.lutGridPoints3D];
                break;
            case eProfileType.Duo:
                inputChannels = 2;
                if (this.useLegacy) {
                    CLUT = this.create2DDeviceLUT(outputChannels, this.lutGridPoints3D);
                } else {
                    // Use new LookupTable for 2D (not yet implemented in LookupTable class)
                    CLUT = this.create2DDeviceLUT(outputChannels, this.lutGridPoints3D);
                }
                gridPoints = [this.lutGridPoints3D, this.lutGridPoints3D];
                break;
            case eProfileType.Lab:
            case eProfileType.RGBMatrix:
            case eProfileType.RGBLut:
                inputChannels = 3;
                // console.dir({pipeline: this.pipeline}, {depth: 3, compact: true, maxArrayLength: 9});

                CLUT = this.create3DDeviceLUT(outputChannels, this.lutGridPoints3D);
                // if (this.useLegacy) {
                //     // console.trace('useLegacy: true');
                //     CLUT = this.create3DDeviceLUT(outputChannels, this.lutGridPoints3D);
                // } else {
                //     // console.trace('useLegacy: false');
                //     CLUT = create3DDeviceLUT(this, outputChannels, this.lutGridPoints3D, {
                //         promoteGrayToCMYKBlack: this.promoteGrayToCMYKBlack
                //     });
                // }
                gridPoints = [this.lutGridPoints3D, this.lutGridPoints3D, this.lutGridPoints3D];
                break;
            case eProfileType.CMYK:
                inputChannels = 4;
                if (this.useLegacy) {
                    // console.trace('useLegacy: true');
                    CLUT = this.create4DDeviceLUT(outputChannels, this.lutGridPoints4D);
                } else {
                    // console.trace('useLegacy: false');
                    CLUT = create4DDeviceLUT(this, outputChannels, this.lutGridPoints4D, {
                        promoteGrayToCMYKBlack: this.promoteGrayToCMYKBlack
                    });
                    console.log(`CMYK-to-${eProfileTypeToString(this.outputProfile.type)}${this.promoteGrayToCMYKBlack ? ' [Promote Gray to CMYKBlack]' : ''}: %o`, CLUT);
                }
                gridPoints = [this.lutGridPoints4D, this.lutGridPoints4D, this.lutGridPoints4D, this.lutGridPoints4D];
                break;
            default:
                throw new TypeError(`Create Lut Invalid input profile type ${this.inputProfile?.type}`);
        }

        if (this.verboseTiming) {
            console.timeEnd('create Prebuilt Lut');
        }

        // convert chain to simplified object for saving
        /** @type {(ProfileObject|eIntent)[]} */
        var chain = [];
        for (const item of this.chain) {
            if (item instanceof Profile) {
                chain.push(profile2Obj(item));
            } else {
                chain.push(item); //intent
            }
        }

        var g1 = gridPoints[0];
        var g2 = g1 * (gridPoints[1] || 0);
        var g3 = g2 * (gridPoints[2] || 0);

        return ({
            // Useful info if we were to just reuse this LUT
            // we can use this to check how the LUT is built
            // By looking at the profile chain
            chain: chain,

            version: 1, // just in case in future we want to change the format

            // lut data
            inputChannels: inputChannels,
            outputChannels: outputChannels,
            gridPoints: gridPoints,
            g1: g1,
            g2: g2,
            g3: g3,
            go0: outputChannels,
            go1: g1 * outputChannels,
            go2: g2 * outputChannels,
            go3: g3 * outputChannels,
            CLUT: CLUT, // data
            encoding: 'number', // number or base64
            precision: null, // Only required for PCS converisons;
            outputScale: 1, // output is already pre-scaled
            inputScale: 1, // input is already pre-scaled
        });

        /**
         * Convert a profile to a simplified object
         * @param {Profile} profile
         * @returns {ProfileObject} simplified object
         */
        function profile2Obj(profile) {
            return {
                header: profile.header,
                name: profile.name,
                type: profile.type,
                intent: profile.intent,
                whitePoint: profile.whitePoint,
                description: profile.description,
                viewingConditions: profile.viewingConditions,
                mediaWhitePoint: profile.mediaWhitePoint,
                PCSEncode: profile.PCSEncode,
                PCSDecode: profile.PCSDecode,
                PCS8BitScale: profile.PCS8BitScale,
                version: profile.version
            };
        }
    };

    /**
     * Create the pipeline of stages to convert from input to output (Monotone)
     * @param outputChannels - Number of output color channels
     * @param gridPoints - Number of grid points for the lookup table
     * @returns 1D device lookup table as Float64Array for monotone transformations
     */
    create1DDeviceLUT(outputChannels, gridPoints) {
        if (this.useLegacy) {
            return create1DDeviceLUT_legacy(this, outputChannels, gridPoints);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.create1DDeviceLUT(outputChannels, gridPoints);
        }

        // Fallback to legacy behavior if no lookupTable exists
        return create1DDeviceLUT_legacy(this, outputChannels, gridPoints);
    }

    /**
     * Generate the CLUT data for a 2D output device LUT (Duotone)
     * @param outputChannels - Number of output color channels
     * @param gridPoints - Number of grid points for the lookup table
     * @returns 2D device lookup table as Float64Array for duotone transformations
     */
    create2DDeviceLUT(outputChannels, gridPoints) {
        if (this.useLegacy) {
            return create2DDeviceLUT_legacy(this, outputChannels, gridPoints);
        }

        // Use new LookupTable implementation
        if (this.lookupTable) {
            return this.lookupTable.create2DDeviceLUT(outputChannels, gridPoints);
        }

        // Fallback to legacy behavior if no lookupTable exists
        return create2DDeviceLUT_legacy(this, outputChannels, gridPoints);
    }

    // /**
    //  * Generate the CLUT data for a 3D output device LUT (RGB/LAB)
    //  * Since RGB, RGBMatrix and Lab are all device encoding inputs are 0.0 - 1.0 we can create a LUT for them the same way
    //  * @param outputChannels - Number of output color channels
    //  * @param gridPoints - Number of grid points for the lookup table
    //  * @returns 3D device lookup table as Float32Array for RGB/Lab transformations
    //  */
    // create3DDeviceLUT(outputChannels, gridPoints) {
    //     return create3DDeviceLUT_legacy(this, outputChannels, gridPoints);
    // }

    /**
     * Generate the CLUT data for a 3D output device LUT (RGB/LAB)
     * Since RGB, RGBMatrix and Lab are all device encoding inputs are 0.0 - 1.0 we can create a LUT for them the same way
     * @param outputChannels - Number of output color channels
     * @param gridPoints - Number of grid points for the lookup table
     * @returns 3D device lookup table as Float32Array for RGB/Lab transformations
     */
    create3DDeviceLUT(outputChannels, gridPoints) {
        if (this.useLegacy) {
            return create3DDeviceLUT_legacy(this, outputChannels, gridPoints);
        } else if (outputChannels === 4 && this.promoteGrayToCMYKBlack) {
            // console.trace('Creating 3D Device LUT');
            return this.create3DDeviceLUT_KOnly(outputChannels, gridPoints);
        } else {
            return create3DDeviceLUT_legacy(this, outputChannels, gridPoints);
        }
    }

    static REVISION = 'x16e';

    /**
     * Create 3D Device LUT with K-Only Black Point Compensation and Gray Component Replacement (GCR).
     * 
     * SPECIALIZED BLACK POINT COMPENSATION APPROACH
     * =============================================
     * 
     * This method implements a specialized black point compensation strategy that treats 100% K 
     * (K-only black) as the effective black point for the transformation, rather than using the 
     * standard CMYK(100,100,100,100) black point. This enables:
     * 
     * 1. **K-Only Gray Promotion**: Neutral gray values are systematically converted to use the 
     *    K (black) channel exclusively, eliminating CMY components in neutral tones
     * 2. **Ink Optimization**: Significantly reduces total ink consumption (TAC) for gray tones
     * 3. **Print Quality**: Improves neutral stability and reduces metamerism in grayscale
     * 4. **Colorimetric Fidelity**: Maintains color accuracy through Lab-space verification
     * 
     * REVISION HISTORY
     * ================
     * 
     * - x16c: Initial implementation with fixed BPC settings (no user BPC, adaptation disabled)
     * - x16d: Default BPC enabled with autoEnableBPC undefined (profile-dependent)
     * - x16e: Uses instance's `this.useBPC` setting for consistent behavior with main transform
     * 
     * BLACK POINT SCALING ALGORITHM
     * =============================
     * 
     * The method uses `estimateNearlyStraightMidRangeBlackpoint` from blackpoint-estimation.js
     * to calculate accurate black point estimates for profiles with non-linear shadow behavior.
     * 
     * This function:
     * 
     * 1. Analyzes the round-trip curve through the profile's B2A/A2B tags
     * 2. Detects "nearly straight midrange" profiles where simple BPC works
     * 3. For complex profiles, uses least-squares curve fitting to find the optimal black point
     * 4. Returns Lab coordinates of the estimated black point
     * 
     * The K-only blackpoint compensation scale factor is calculated by comparing:
     * 
     * - Standard output black point: Lab of profile's deepest achievable black
     * - K-only output black point: Lab of CMYK(0,0,0,100)
     * 
     * Scale formula (from `applyBlackpointCompensation` in blackpoint-estimation.js):
     * 
     * ```math
     * scale = (1 - Y_{konly}) / (1 - Y_{standard})
     * ```
     * 
     * Where Y is the XYZ Y component (luminance) of each black point.
     * 
     * GRAY COMPONENT REPLACEMENT (GCR) WORKFLOW
     * =========================================
     * 
     * For each RGB input in the 3D LUT grid:
     * 
     * 1. **Transform to Output Space**
     * 
     *    - Convert RGB → Lab using input profile (via `transformInputDevice2Lab`)
     *    - Apply K-only BPC scaling to Lab using `applyBlackpointCompensation()`
     *    - Convert scaled Lab → CMYK using output profile
     * 
     * 2. **Normalized Lab Construction**
     * 
     *    - Create "normalizedLab" with BPC-scaled L\* but original a* and b* values
     *    - This preserves chromaticity while adjusting lightness for K-only black
     *    - Convert normalizedLab → CMYK for GCR processing
     * 
     * 3. **Neutral Detection and Chroma Analysis**
     * 
     *    - Calculate input chroma: $sqrt(a² + b²)$
     *    - Near-neutral colors (chroma < 0.5) are treated as perfectly neutral
     *    - Normalized chroma factor: $log(1 + chroma) / log(6)$ for smooth rolloff
     * 
     * 4. **Gray Component Extraction**
     * 
     *    - Gray component: $min(C, M, Y)$ - The shared neutral portion
     *    - Chromatic component: each CMY value minus gray component, scaled by chroma factor
     *    - For neutrals (low chroma), CMY channels go to zero
     * 
     * 5. **K-Channel Promotion**
     * 
     *    - Gray component: $K_{new} = K_{original} + ({GrayComponent} / 2)$
     *    - Approximates UCR (Under Color Removal) behavior
     *    - Maintains ink limit compliance
     * 
     * 6. **Iterative L\* Matching (First Pass)**
     *  
     *    - Adjust K in ±0.125% increments until output L\* matches scaled target L\*
     *    - Uses `transformOutputDevice2Lab` for verification
     *    - Protected by MAX_L_MATCH_ITERATIONS (default 1000, Infinity if debugging.disableLoopSafety)
     * 
     * 7. **Chroma Restoration (for Chromatic Colors)**
     * 
     *    - For colors with inputChroma > 1.0 and outputChroma deficit > 0.5:
     *      1. Incrementally add back primary and secondary CMY components
     *      2. Step sizes proportional to original CMY ratios
     *      3. Inner L\* matching loop maintains lightness during chroma restoration
     *      4. Protected by MAX_CHROMA_OPTIMIZATION_ITERATIONS
     * 
     * 8.  **Final L\* Correction**
     * 
     *    - Fine-tune K to match target L\* after all GCR adjustments
     *    - Uses adaptive step size: $min(0.125, |∆L|/2)$
     *    - Respects K-only black point: $floor(scaledOutputKOnlyBlackpointLab.L)$
     * 
     * 9.  **Value Clamping**
     * 
     *    - K values ≥99.5% rounded to 100%, ≤0.5% rounded to 0%
     *    - When K=100%, CMY channels forced to 0% (pure K black)
     *    - CMY values similarly clamped at 0.5% and 99.5% thresholds
     * 
     * MAXIMUM GCR DETECTION
     * =====================
     * 
     * The method automatically detects if the output profile already uses maximum GCR
     * by checking if Lab(0,0,0) round-trips to CMYK with K=100% and C=M=Y≈0%.
     * In such cases, it uses the standard transform without additional processing.
     * 
     * TRANSFORM SETUP
     * ===============
     * 
     * Creates multiple internal transforms for different conversion paths:
     * 
     * - `transformLab2InputDevice` / `transformInputDevice2Lab`: For input profile conversions
     * - `transformLab2OutputDevice` / `transformOutputDevice2Lab`: For output profile conversions
     * - `transformInputDevice2OutputDevice` / `transformOutputDevice2InputDevice`: Direct device paths
     * - Additional perceptual/relative/absolute intent transforms for black point estimation
     * 
     * All internal transforms inherit `precision`, `useLegacy`, `useAdaptation`, and `debugging`
     * settings from the parent transform. BPC settings vary by revision and intent.
     * 
     * DEBUGGING SUPPORT
     * =================
     * 
     * When `this.debugging.create3DDeviceLUT_KOnly` is enabled:
     * 
     * - Logs timing information for LUT creation
     * - Outputs reference black/white points table
     * - Detailed stage-by-stage output for test colors (pure black, 25%, 50%, 75% grays)
     * 
     * Additional debugging flags:
     * 
     * - `estimateKOnlyBlackpoint`: Detailed BPC scale calculations and verification tables
     * - `kOnlyTables`: Comprehensive reference point tables
     * - `traceBPCTransform`: Per-pixel BPC transformation traces
     * - `disableLoopSafety`: Removes iteration limits (use with caution)
     * 
     * IMPLEMENTATION DETAILS
     * ======================
     * 
     * - Uses `estimateBlackpoint()` from blackpoint-estimation.js for initial estimate
     * - Uses `estimateNearlyStraightMidRangeBlackpoint()` for shadow curve analysis
     * - Uses `applyBlackpointCompensation()` for Lab space scaling
     * - Grid step calculated as 1/(gridPoints-1) for proper endpoint coverage
     * - Returns Float64Array for maximum precision in downstream interpolation
     * 
     * @param {number} outputChannels - Number of output channels (must be 4 for CMYK)
     * @param {number} gridPoints - Number of grid points per dimension for LUT resolution
     *                               (e.g., 33 creates a 33×33×33 grid with 35,937 points)
     * @returns {Float64Array} Flattened CLUT data array with K-only BPC and GCR applied.
     *                         Length: gridPoints³ × outputChannels, values in range [0,1]
     * 
     * @see {@link ./blackpoint-estimation.js} for BPC algorithms
     * @see create3DDeviceLUT - Standard 3D LUT creation without K-only optimization
     * @see promoteGrayToCMYKBlack - Transform option that activates this method
     * 
     * @example
     * 
     * ```js
     * // Enable K-only gray promotion when creating transform
     * const transform = new Transform({
     *     promoteGrayToCMYKBlack: true,
     *     buildLUT: true,
     *     BPC: true  // Recommended for consistent K-only behavior
     * });
     * transform.create(sRGBProfile, cmykProfile, eIntent.relative);
     * 
     * // Neutral gray RGB(128,128,128) will convert to approximately CMYK(0,0,0,50)
     * // instead of CMYK(25,25,25,25) or similar CMY-heavy result
     * ```
     * 
     */
    create3DDeviceLUT_KOnly(outputChannels, gridPoints) {
        const debugging_create3DDeviceLUT_KOnly = this.debugging?.['create3DDeviceLUT_KOnly'];
        const MAX_L_MATCH_ITERATIONS = this.debugging?.disableLoopSafety ? Infinity : 1000;
        const MAX_CHROMA_OPTIMIZATION_ITERATIONS = this.debugging?.disableLoopSafety ? Infinity : 1000;
        const MAX_INNER_L_MATCH_ITERATIONS = this.debugging?.disableLoopSafety ? Infinity : 1000;

        if (this.verboseTiming || debugging_create3DDeviceLUT_KOnly) console.time('Creating 3D Device LUT');

        const lutsize = gridPoints * gridPoints * gridPoints;
        const CLUT = new Float64Array(outputChannels * lutsize);
        const gridStep = 1 / (gridPoints - 1);

        const { REVISION = 'x16d' } = Transform;

        const {
            neutralTolerance, precision, useLegacy, buildLUT, useAdaptation, useBPC, autoEnableBPC
        } = {
            /**  Neutral detection tolerance in Lab space. @type {number} */
            neutralTolerance: 2.0,
            /** Number of decimal places to round LUT values to (for smaller JSON output). @type {number=} */
            precision: undefined,
            /** Use legacy LUT implementation for backward compatibility. @type {boolean=} */
            useLegacy: false,
            /** Whether to build a LUT for the transformation. @type {boolean=} */
            buildLUT: false,
            /** Whether to apply chromatic adaptation during color transformations. @type {boolean=} */
            useAdaptation: undefined,
            /** Whether to apply Black Point Compensation (BPC) during transformations. @type {boolean=} */
            useBPC: true,
            /** Whether to automatically enable Black Point Compensation (BPC) based on profile characteristics. @type {boolean=} */
            autoEnableBPC: undefined,
            ...{
                'x16c': { useLegacy: false, buildLUT: false, usesAdaptation: true, useBPC: false, autoEnableBPC: false },
                'x16d': { useLegacy: false, buildLUT: false, usesAdaptation: undefined, useBPC: true, autoEnableBPC: undefined },
                'x16e': { useLegacy: false, buildLUT: false, usesAdaptation: undefined, useBPC: this.useBPC, autoEnableBPC: undefined },
            }[REVISION] || {},
        };

        const outputProfileType = this.outputProfile?.type;
        const inputProfileType = this.inputProfile?.type;

        const labProfile = new Profile('*LabD50');
        const inputProfile = /** @type {Profile} */ (this.chain.at(0));
        const inputIntent = /** @type {eIntent} */ (this.chain.at(1));
        const transformLab2InputDevice = /** @type {Lab2RGBTransform} */ (new Transform({ precision, useLegacy, useAdaptation, BPC: useBPC, autoEnableBPC, buildLUT, debugging: this.debugging }));
        const transformInputDevice2Lab = /** @type {RGB2LabTransform} */ (new Transform({ precision, useLegacy, useAdaptation, BPC: useBPC, autoEnableBPC, buildLUT, debugging: this.debugging }));

        transformLab2InputDevice.create(labProfile, inputProfile, eIntent.relative);

        transformInputDevice2Lab.create(inputProfile, labProfile, eIntent.relative);

        const outputProfile = /** @type {Profile} */ (this.chain.at(-1));
        const outputIntent = /** @type {eIntent} */ (this.chain.at(-2));

        const transformLab2OutputDevice = /** @type {Lab2CMYKTransform} */ (new Transform({ precision, useLegacy, useAdaptation, BPC: useBPC, autoEnableBPC, buildLUT, debugging: this.debugging }));
        const transformOutputDevice2Lab = /** @type {CMYK2LabTransform} */ (new Transform({ precision, useLegacy, useAdaptation, BPC: useBPC, autoEnableBPC, buildLUT, debugging: this.debugging }));

        transformLab2OutputDevice.create(labProfile, outputProfile, eIntent.relative);

        transformOutputDevice2Lab.create(outputProfile, labProfile, eIntent.relative);

        const transformInputDevice2OutputDevice = /** @type {RGB2CMYKTransform} */ (new Transform({ precision, useLegacy, useAdaptation, BPC: useBPC, autoEnableBPC, buildLUT, debugging: this.debugging }));
        transformInputDevice2OutputDevice.create(inputProfile, outputProfile, inputIntent);

        const transformOutputDevice2InputDevice = /** @type {CMYK2RGBTransform} */ (new Transform({ precision, useLegacy, useAdaptation, BPC: useBPC, autoEnableBPC, buildLUT, debugging: this.debugging }));
        transformOutputDevice2InputDevice.create(outputProfile, inputProfile, inputIntent);

        const labD50Color = (a, b, c) => convert.Lab(a * 100, b * 255 - 128, c * 255 - 128);
        const labColor = (a, b, c) => convert.Lab(a * 100, b * 255 - 128, c * 255 - 128);
        const rgbColor = (r, g, b) => convert.RGB(r * 255, g * 255, b * 255);
        const cmykColor = (c, m, y, k) => convert.CMYK(c * 100, m * 100, y * 100, k * 100);
        const xyzColor = (x, y, z) => convert.XYZ(x * 100, y * 100, z * 100);

        if (debugging_create3DDeviceLUT_KOnly) {
            const outputWhitepointLab = transformOutputDevice2Lab.forward({ C: 0, M: 0, Y: 0, K: 0, type: eColourType.CMYK });
            const outputBlackpointLab = transformOutputDevice2Lab.forward({ C: 100, M: 100, Y: 100, K: 100, type: eColourType.CMYK });
            const outputKOnlyBlackpointLab = transformOutputDevice2Lab.forward({ C: 0, M: 0, Y: 0, K: 100, type: eColourType.CMYK });
            const outputCMYOnlyBlackpointLab = transformOutputDevice2Lab.forward({ C: 100, M: 100, Y: 100, K: 0, type: eColourType.CMYK });

            const inputBlackpointLab = transformInputDevice2Lab.forward(rgbColor(0, 0, 0));
            const inputWhitepointLab = transformInputDevice2Lab.forward(rgbColor(1, 1, 1));

            console.table(
                Object.fromEntries(Object.entries(/** @type {Record<string, [import('./def.js')._cmsLab, import('./def.js')._cmsCMYK]>} */({
                    outputWhitepoint: [outputWhitepointLab, transformLab2OutputDevice.forward(outputWhitepointLab)],
                    outputBlackpoint: [outputBlackpointLab, transformLab2OutputDevice.forward(outputBlackpointLab)],
                    outputKOnlyBlackpoint: [outputKOnlyBlackpointLab, transformLab2OutputDevice.forward(outputKOnlyBlackpointLab)],
                    outputCMYOnlyBlackpoint: [outputCMYOnlyBlackpointLab, transformLab2OutputDevice.forward(outputCMYOnlyBlackpointLab)],
                    inputWhitepoint: [inputWhitepointLab, transformLab2OutputDevice.forward(inputWhitepointLab)],
                    inputBlackpoint: [inputBlackpointLab, transformLab2OutputDevice.forward(inputBlackpointLab)],
                })).map(([key, [{ L, a, b }, { C, M, Y, K }]]) =>
                    [key, Object.fromEntries(Object.entries({ L, a, b, C, M, Y, K }).map(([c, v]) => [c, Number(v.toFixed(2))]))]
                )));
        }

        const {
            applyKOnlyBlackpointCompensation,
            isMaximumGCR,
            references: computedReferences,
            references: { scaledOutputKOnlyBlackpointLab },
        } = (
            /**
             * Compute advanced black point compensation references.
             * 
             * @param {object} options
             * @param {eIntent} [options.outputIntent]
             */
            ({ outputIntent = eIntent.relative }) => {

                /** @typedef {'perceptual' | 'relative' | 'absolute' | 'saturation'} RenderingIntentLowerCase */

                const userIntent = /** @type {RenderingIntentLowerCase} */(intent2String(outputIntent).toLowerCase());

                /** @type {Record<RenderingIntentLowerCase, { lab2CMYKTransform: Lab2CMYKTransform, cmyk2LabTransform: CMYK2LabTransform }>} */
                const transforms = {};

                // /** @type {Partial<TransformOptions>} */
                /** @type {Partial<Record<typeof userIntent|'*', Partial<TransformOptions>>>} */
                const transformDefaults = {
                    'x16c': {
                        ['*']: { useLegacy: false, buildLUT: false, useAdaptation: false, BPC: false, autoEnableBPC: false, useBPC: false },
                        ['relative']: { /* useAdaptation: true, useBPC: true, BPC: true, autoEnableBPC: true */ },
                    },
                    'x16d': {
                        ['*']: { useLegacy: false, buildLUT: false, useAdaptation: false, BPC: false, autoEnableBPC: false, useBPC: undefined },
                        ['relative']: { useLegacy: false, buildLUT: false, useAdaptation: false, BPC: true, autoEnableBPC: false, useBPC: undefined },
                    },
                    'x16e': {
                        ['*']: { useLegacy: false, buildLUT: false, useAdaptation: false, BPC: this.useBPC, autoEnableBPC: false },
                        ['relative']: { useLegacy: false, buildLUT: false, useAdaptation: false, BPC: this.useBPC, autoEnableBPC: true },
                    },
                }[REVISION] || {};

                /** @type {Lab2CMYKTransform} */
                const perceptualLab2CMYKTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['perceptual'], debugging: this.debugging });
                /** @type {CMYK2LabTransform} */
                const perceptualCMYK2LabTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['perceptual'] });

                perceptualLab2CMYKTransform.create(labProfile, outputProfile, eIntent.perceptual);
                perceptualCMYK2LabTransform.create(outputProfile, labProfile, eIntent.perceptual);

                transforms.perceptual = { lab2CMYKTransform: perceptualLab2CMYKTransform, cmyk2LabTransform: perceptualCMYK2LabTransform };

                /** @type {Lab2CMYKTransform} */
                const relativeLab2CMYKTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['relative'], debugging: this.debugging });
                /** @type {CMYK2LabTransform} */
                const relativeCMYK2LabTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['relative'], debugging: this.debugging });

                relativeLab2CMYKTransform.create(labProfile, outputProfile, eIntent.relative);
                relativeCMYK2LabTransform.create(outputProfile, labProfile, eIntent.relative);

                transforms.relative = { lab2CMYKTransform: relativeLab2CMYKTransform, cmyk2LabTransform: relativeCMYK2LabTransform };

                /** @type {Lab2CMYKTransform} */
                const absoluteLab2CMYKTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['absolute'], debugging: this.debugging });
                /** @type {CMYK2LabTransform} */
                const absoluteCMYK2LabTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['absolute'], debugging: this.debugging });

                absoluteLab2CMYKTransform.create(labProfile, outputProfile, eIntent.absolute);
                absoluteCMYK2LabTransform.create(outputProfile, labProfile, eIntent.absolute);

                transforms.absolute = { lab2CMYKTransform: absoluteLab2CMYKTransform, cmyk2LabTransform: absoluteCMYK2LabTransform };

                /** @type {Lab2CMYKTransform} */
                const userIntentLab2CMYKTransform = transforms[userIntent]?.lab2CMYKTransform ?? new Transform({ ...transformDefaults['*'], ...transformDefaults[userIntent], debugging: this.debugging });
                /** @type {CMYK2LabTransform} */
                const userIntentCMYK2LabTransform = transforms[userIntent]?.cmyk2LabTransform ?? new Transform({ ...transformDefaults['*'], ...transformDefaults[userIntent], debugging: this.debugging });

                if (userIntent !== 'perceptual' && userIntent !== 'relative') {
                    userIntentLab2CMYKTransform.create(outputProfile, labProfile, eIntent[userIntent]);
                    userIntentCMYK2LabTransform.create(labProfile, outputProfile, eIntent[userIntent]);
                }

                transforms[userIntent] ??= { lab2CMYKTransform: userIntentLab2CMYKTransform, cmyk2LabTransform: userIntentCMYK2LabTransform };

                const references = {};

                references.whitepointCMYK = /** @type {import('./def.js')._cmsCMYK} */({ C: 0, M: 0, Y: 0, K: 0, type: eColourType.CMYK });
                references.blackpointKOnlyCMYK = /** @type {import('./def.js')._cmsCMYK} */({ C: 0, M: 0, Y: 0, K: 100, type: eColourType.CMYK });
                references.blackpointCMYK = /** @type {import('./def.js')._cmsCMYK} */({ C: 100, M: 100, Y: 100, K: 100, type: eColourType.CMYK });

                references.whitepointLab = labD50Color(100, 0, 0);
                references.blackpointLab = labD50Color(0, 0, 0);
                references.whitepointRGB = rgbColor(255, 255, 255);
                references.blackpointRGB = rgbColor(0, 0, 0);

                const deviceToPCS = (transform, deviceColor) => {

                };
                const pcsToDevice = (transform, pcsColor) => {

                };

                references.perceptualDestinationWhitepointLab = perceptualCMYK2LabTransform.forward(references.whitepointCMYK);
                references.perceptualDestinationWhitepointCMYK = perceptualLab2CMYKTransform.forward(references.perceptualDestinationWhitepointLab);
                references.perceptualDestinationWhitepointXYZ = convert.Lab2XYZ(references.perceptualDestinationWhitepointLab);

                references.relativeDestinationWhitepointLab = relativeCMYK2LabTransform.forward(references.whitepointCMYK);
                references.relativeDestinationWhitepointCMYK = relativeLab2CMYKTransform.forward(references.relativeDestinationWhitepointLab);
                references.relativeDestinationWhitepointXYZ = convert.Lab2XYZ(references.relativeDestinationWhitepointLab);

                references.destinationWhitepointLab = userIntentCMYK2LabTransform.forward(references.whitepointCMYK);
                references.destinationWhitepointCMYK = userIntentLab2CMYKTransform.forward(references.destinationWhitepointLab);
                references.destinationWhitepointXYZ = convert.Lab2XYZ(references.destinationWhitepointLab);

                references.perceptualDestinationKOnlyBlackpointCMYK = references.blackpointKOnlyCMYK;
                references.perceptualDestinationKOnlyBlackpointLab = perceptualCMYK2LabTransform.forward(references.perceptualDestinationKOnlyBlackpointCMYK);
                references.perceptualDestinationKOnlyBlackpointXYZ = convert.Lab2XYZ(references.perceptualDestinationKOnlyBlackpointLab);

                references.relativeDestinationKOnlyBlackpointCMYK = references.blackpointKOnlyCMYK;
                references.relativeDestinationKOnlyBlackpointLab = relativeCMYK2LabTransform.forward(references.relativeDestinationKOnlyBlackpointCMYK);
                references.relativeDestinationKOnlyBlackpointXYZ = convert.Lab2XYZ(references.relativeDestinationKOnlyBlackpointLab);

                references.absoluteDestinationKOnlyBlackpointCMYK = references.blackpointKOnlyCMYK;
                references.absoluteDestinationKOnlyBlackpointLab = absoluteCMYK2LabTransform.forward(references.absoluteDestinationKOnlyBlackpointCMYK);
                references.absoluteDestinationKOnlyBlackpointXYZ = convert.Lab2XYZ(references.absoluteDestinationKOnlyBlackpointLab);

                references.destinationKOnlyBlackpointCMYK = references.blackpointKOnlyCMYK;
                references.destinationKOnlyBlackpointLab = userIntentCMYK2LabTransform.forward(references.destinationKOnlyBlackpointCMYK);
                references.destinationKOnlyBlackpointXYZ = convert.Lab2XYZ(references.destinationKOnlyBlackpointLab);

                references.perceptualDestinationBlackpointLabFromLab = perceptualCMYK2LabTransform.forward(perceptualLab2CMYKTransform.forward(references.blackpointLab));
                references.perceptualDestinationBlackpointLabFromCMYK = perceptualCMYK2LabTransform.forward(references.blackpointCMYK);
                references.perceptualDestinationBlackpointLab = references.perceptualDestinationBlackpointLabFromLab.L < references.perceptualDestinationBlackpointLabFromCMYK.L ? references.perceptualDestinationBlackpointLabFromLab : references.perceptualDestinationBlackpointLabFromCMYK;
                references.effectivePerceptualDestinationBlackpointLab = references.perceptualDestinationKOnlyBlackpointLab.L < references.perceptualDestinationBlackpointLab.L ? references.perceptualDestinationKOnlyBlackpointLab : references.perceptualDestinationBlackpointLab;
                references.perceptualDestinationBlackpointCMYK = perceptualLab2CMYKTransform.forward(references.perceptualDestinationBlackpointLab);
                references.perceptualDestinationBlackpointXYZ = convert.Lab2XYZ(references.perceptualDestinationBlackpointLab);

                references.relativeDestinationBlackpointLabFromLab = relativeCMYK2LabTransform.forward(relativeLab2CMYKTransform.forward(references.blackpointLab));
                references.relativeDestinationBlackpointLabFromCMYK = relativeCMYK2LabTransform.forward(references.blackpointCMYK);
                references.relativeDestinationBlackpointLab = references.relativeDestinationBlackpointLabFromLab.L < references.relativeDestinationBlackpointLabFromCMYK.L ? references.relativeDestinationBlackpointLabFromLab : references.relativeDestinationBlackpointLabFromCMYK;
                references.effectiveRelativeDestinationBlackpointLab = references.relativeDestinationKOnlyBlackpointLab.L < references.relativeDestinationBlackpointLab.L ? references.relativeDestinationKOnlyBlackpointLab : references.relativeDestinationBlackpointLab;
                references.relativeDestinationBlackpointCMYK = relativeLab2CMYKTransform.forward(references.relativeDestinationBlackpointLab);
                references.relativeDestinationBlackpointXYZ = convert.Lab2XYZ(references.relativeDestinationBlackpointLab);

                references.absoluteDestinationBlackpointLabFromLab = absoluteCMYK2LabTransform.forward(absoluteLab2CMYKTransform.forward(references.blackpointLab));
                references.absoluteDestinationBlackpointLabFromCMYK = absoluteCMYK2LabTransform.forward(references.blackpointCMYK);
                references.absoluteDestinationBlackpointLab = references.absoluteDestinationBlackpointLabFromLab.L < references.absoluteDestinationBlackpointLabFromCMYK.L ? references.absoluteDestinationBlackpointLabFromLab : references.absoluteDestinationBlackpointLabFromCMYK;
                references.effectiveAbsoluteDestinationBlackpointLab = references.absoluteDestinationKOnlyBlackpointLab.L < references.absoluteDestinationBlackpointLab.L ? references.absoluteDestinationKOnlyBlackpointLab : references.absoluteDestinationBlackpointLab;
                references.absoluteDestinationBlackpointCMYK = absoluteLab2CMYKTransform.forward(references.absoluteDestinationBlackpointLab);
                references.absoluteDestinationBlackpointXYZ = convert.Lab2XYZ(references.absoluteDestinationBlackpointLab);

                // const destinationBlackpointLab = userIntentCMYK2LabTransform.forward(userIntentLab2CMYKTransform.forward(references.blackpointLab));
                references.destinationBlackpointLab = userIntentCMYK2LabTransform.forward(references.blackpointCMYK);
                references.destinationBlackpointCMYK = userIntentLab2CMYKTransform.forward(references.destinationBlackpointLab);
                references.destinationBlackpointXYZ = convert.Lab2XYZ(references.destinationBlackpointLab);

                /** @type {RGB2LabTransform} */
                const perceptualSourceRGB2LabTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['perceptual'], debugging: this.debugging });
                /** @type {Lab2RGBTransform} */
                const perceptualLab2SourceRGBTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['perceptual'], debugging: this.debugging });

                perceptualSourceRGB2LabTransform.create(inputProfile, labProfile, eIntent.perceptual);
                perceptualLab2SourceRGBTransform.create(labProfile, outputProfile, eIntent.perceptual);

                references.perceptualSourceBlackpointRGB = references.blackpointRGB;
                references.perceptualSourceBlackpointLab = perceptualSourceRGB2LabTransform.forward(references.perceptualSourceBlackpointRGB);
                references.perceptualSourceBlackpointXYZ = convert.Lab2XYZ(references.perceptualSourceBlackpointLab);

                /** @type {RGB2LabTransform} */
                const relativeSourceRGB2LabTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['relative'], debugging: this.debugging });
                /** @type {Lab2RGBTransform} */
                const relativeLab2SourceRGBTransform = new Transform({ ...transformDefaults['*'], ...transformDefaults['relative'], debugging: this.debugging });

                relativeSourceRGB2LabTransform.create(inputProfile, labProfile, eIntent.relative);
                relativeLab2SourceRGBTransform.create(labProfile, outputProfile, eIntent.relative);

                references.relativeSourceBlackpointRGB = references.blackpointRGB;
                references.relativeSourceBlackpointLab = relativeSourceRGB2LabTransform.forward(references.relativeSourceBlackpointRGB);
                references.relativeSourceBlackpointXYZ = convert.Lab2XYZ(references.relativeSourceBlackpointLab);

                const { estimatedBlackpointLab, estimatedKOnlyBlackpointLab } = (() => {
                    const btKOnly = btx => {
                        const bty = userIntentLab2CMYKTransform.forward(btx);
                        const gc = Math.max(0, Math.min(100, bty.C, bty.M, bty.Y, 100 - bty.K));
                        const btygc = {
                            C: Math.max(0, Math.min(100, bty.C - gc)),
                            M: Math.max(0, Math.min(100, bty.M - gc)),
                            Y: Math.max(0, Math.min(100, bty.Y - gc)),
                            K: Math.max(0, Math.min(100, bty.K + gc)),
                            type: eColourType.CMYK,
                        };
                        const btgc = relativeCMYK2LabTransform.forward(btygc);
                        // console.log({ btx, bty, gc, btygc, btgc });
                        return btgc;
                    };
                    const bt = btx => {
                        const bty = userIntentLab2CMYKTransform.forward(btx);
                        const bt = relativeCMYK2LabTransform.forward(bty);
                        // console.log({ btx, bty, bt });
                        return bt;
                    };

                    /** @type {import('./def.js')._cmsLab} */
                    let initialLab;
                    /** @type {import('./def.js')._cmsLab} */
                    let initialKOnlyLab;

                    /** @type {boolean} */
                    let isNearlyStraightMidrange;
                    /** @type {boolean} */
                    let isNearlyStraightMidrangeKOnly;

                    /** @type {import('./def.js')._cmsLabD50} */
                    let destinationBlackpointLab;
                    /** @type {import('./def.js')._cmsLabD50} */
                    let destinationKOnlyBlackpointLab;

                    const calculateDestinationBlackpoint = (initialLab, blackpointTransform, intent, debug = false) => {

                        const lMin = blackpointTransform({ ...initialLab, L: 0 }).L;
                        const lMax = blackpointTransform({ ...initialLab, L: 100 }).L;

                        if (debug) {
                            console.log(`[JS calculateDestinationBlackpoint] lMin=${lMin}, lMax=${lMax}, threshold=${lMin + 0.2 * (lMax - lMin)}`);
                        }

                        for (let l = 0, lBT; l <= 100; l++) {
                            if ((lBT = blackpointTransform({ ...initialLab, L: l }).L) > (lMin + 0.2 * (lMax - lMin)) && Math.abs(lBT - l) > 4) {
                                if (debug) {
                                    console.log(`[JS calculateDestinationBlackpoint] Non-linearity detected at L=${l}: lBT=${lBT}, diff=${Math.abs(lBT - l)}`);
                                    console.log(`[JS calculateDestinationBlackpoint] Calling shadow analysis...`);
                                }
                                return estimateNearlyStraightMidRangeBlackpoint(initialLab, blackpointTransform, intent, debug);
                            }
                        }

                        if (debug) {
                            console.log(`[JS calculateDestinationBlackpoint] Curve is linear, using direct estimate L*=${initialLab.L}`);
                        }
                        return initialLab;
                    };

                    if (outputIntent === eIntent.relative) {
                        /** @type {[outputProfile, outputIntent, perceptualLab2CMYKTransform, relativeCMYK2LabTransform, userIntentLab2CMYKTransform, userIntentCMYK2LabTransform]} */
                        const estimateBlackpointParameters = [outputProfile, outputIntent, perceptualLab2CMYKTransform, relativeCMYK2LabTransform, userIntentLab2CMYKTransform, userIntentCMYK2LabTransform];

                        destinationBlackpointLab = calculateDestinationBlackpoint(estimateBlackpoint(...estimateBlackpointParameters, cmykColor(100, 100, 100, 100)), bt, 'relative');
                        destinationKOnlyBlackpointLab = userIntentCMYK2LabTransform.forward(cmykColor(0, 0, 0, 100));
                        if (this.debugging?.estimateKOnlyBlackpoint) console.table({ destinationBlackpointLab, destinationKOnlyBlackpointLab });
                    }

                    if (
                        (isNaN(destinationBlackpointLab?.L) || destinationBlackpointLab.L < 0 || destinationBlackpointLab.L > 50)
                        || (isNaN(destinationKOnlyBlackpointLab?.L) || destinationKOnlyBlackpointLab?.L < 0 || destinationKOnlyBlackpointLab?.L > 50)
                    ) {
                        if (isNaN(destinationBlackpointLab?.L) || destinationBlackpointLab.L < 0 || destinationBlackpointLab.L > 50)
                            destinationBlackpointLab = relativeCMYK2LabTransform.forward(userIntentLab2CMYKTransform.forward(labD50Color(0, 0, 0)));

                        if (isNaN(destinationBlackpointLab?.L) || destinationBlackpointLab.L < 0 || destinationBlackpointLab.L > 50)
                            destinationBlackpointLab = userIntentCMYK2LabTransform.forward(cmykColor(100, 100, 100, 100));

                        if (isNaN(destinationBlackpointLab?.L) || destinationBlackpointLab.L < 0 || destinationBlackpointLab.L > 50)
                            destinationBlackpointLab = labD50Color(0, 0, 0);

                        if (isNaN(destinationKOnlyBlackpointLab?.L) || destinationKOnlyBlackpointLab.L < 0 || destinationKOnlyBlackpointLab.L > 50)
                            destinationKOnlyBlackpointLab = labD50Color(0, 0, 0);

                        if (this.debugging?.estimateKOnlyBlackpoint) console.table({ destinationBlackpointLab, destinationKOnlyBlackpointLab }, ['L', 'a', 'b']);
                    }

                    return {
                        estimatedBlackpointLab: destinationBlackpointLab,
                        estimatedKOnlyBlackpointLab: destinationKOnlyBlackpointLab,
                    };

                })();

                references.estimatedBlackpointLab = estimatedBlackpointLab;
                references.estimatedKOnlyBlackpointLab = estimatedKOnlyBlackpointLab;

                if (this.debugging?.estimateKOnlyBlackpoint) {
                    console.log('\n[JS] K-Only BPC Scale Calculation:');
                    console.log(`  K-only blackpoint Lab: L=${estimatedKOnlyBlackpointLab.L.toFixed(6)}, a=${estimatedKOnlyBlackpointLab.a.toFixed(6)}, b=${estimatedKOnlyBlackpointLab.b.toFixed(6)}`);
                    console.log(`  K-only blackpoint XYZ.Y: ${convert.Lab2XYZ(estimatedKOnlyBlackpointLab).Y.toFixed(6)}`);
                    console.log(`  Standard blackpoint Lab: L=${estimatedBlackpointLab.L.toFixed(6)}, a=${estimatedBlackpointLab.a.toFixed(6)}, b=${estimatedBlackpointLab.b.toFixed(6)}`);
                    console.log(`  Standard blackpoint XYZ.Y: ${convert.Lab2XYZ(estimatedBlackpointLab).Y.toFixed(6)}`);
                }

                references.prerceptualKOnlyBlackpointCompensationScale = (1 - convert.Lab2XYZ({ ...references.perceptualDestinationKOnlyBlackpointLab, a: 0, b: 0 }).Y) / (1 - convert.Lab2XYZ({ ...references.effectivePerceptualDestinationBlackpointLab, a: 0, b: 0 }).Y);
                references.estimatedKOnlyBlackpointCompensationScale = Math.min(1, (1 - convert.Lab2XYZ(estimatedKOnlyBlackpointLab).Y) / (1 - convert.Lab2XYZ(estimatedBlackpointLab).Y));

                if (this.debugging?.estimateKOnlyBlackpoint) {
                    console.log(`  BPC Scale: (1 - ${convert.Lab2XYZ(estimatedKOnlyBlackpointLab).Y.toFixed(6)}) / (1 - ${convert.Lab2XYZ(estimatedBlackpointLab).Y.toFixed(6)}) = ${references.estimatedKOnlyBlackpointCompensationScale.toFixed(6)}\n`);
                }

                /** @param {import('./def.js')._cmsLab} sourceLab */
                const applyKOnlyBlackpointCompensation = sourceLab => applyBlackpointCompensation(sourceLab, references.effectiveKOnlyBlackpointCompensationScale, undefined, this.debugging?.traceBPCTransform);

                let isMaximumGCR = false;

                if (Math.abs(1 - references.estimatedKOnlyBlackpointCompensationScale) < 0.0000001) {
                    references.estimatedKOnlyBlackpointCompensationScale = 1;

                    const roundTripCMYK = userIntentLab2CMYKTransform.forward(userIntentCMYK2LabTransform.forward(cmykColor(100, 100, 100, 100)));
                    isMaximumGCR = (roundTripCMYK.C + roundTripCMYK.M + roundTripCMYK.Y) < 0.000001 && roundTripCMYK.K > 99.99999;
                    if (this.debugging?.estimateKOnlyBlackpoint) {
                        console.log({ isMaximumGCR });
                    }
                }

                {
                    let effectiveKOnlyBlackpointCompensationScale = references.estimatedKOnlyBlackpointCompensationScale;
                    let effectiveKOnlyBlackpointCompensationScaleReversed = 1 / effectiveKOnlyBlackpointCompensationScale;

                    const applyPerceptualKOnlyBlackpointCompensation = sourceLab => applyBlackpointCompensation(sourceLab, effectiveKOnlyBlackpointCompensationScale, undefined, this.debugging?.traceBPCTransform);
                    const applyKOnlyBlackpointCompensation = sourceLab => applyBlackpointCompensation(sourceLab, effectiveKOnlyBlackpointCompensationScale, undefined, this.debugging?.traceBPCTransform);
                    const revertKOnlyBlackpointCompensation = sourceLab => applyBlackpointCompensation(sourceLab, effectiveKOnlyBlackpointCompensationScaleReversed, undefined, this.debugging?.traceBPCTransform);

                    let inputBlackLab = labD50Color(0, 0, 0);

                    let legacyOutputInkLimitedBlackLab = this.findInkLimitedBlackpoint(outputProfile);
                    let legacyOutputBlackLab = this.findMaxColourantBlackpoint(outputProfile, outputIntent);
                    let legacyOutputDetectedBlackLab = new Transform({ debugging: this.debugging }).detectBlackpoint(outputProfile, outputIntent);
                    let legacyOutputDetectedOutputBlackLab = new Transform({ debugging: this.debugging }).detectOutputBlackpoint(outputProfile, outputIntent);
                    let legacyOutputBlackPerceptualLab = this.findMaxColourantBlackpoint(outputProfile, eIntent.perceptual);
                    let legacyOutputDetectedBlackPerceptualLab = new Transform({ debugging: this.debugging }).detectBlackpoint(outputProfile, eIntent.perceptual);
                    let legacyOutputDetectedOutputBlackPerceptualLab = new Transform({ debugging: this.debugging }).detectOutputBlackpoint(outputProfile, eIntent.perceptual);
                    let outputWhiteCMYK = convert.CMYK(0, 0, 0, 0);
                    let outputWhiteLab = userIntentCMYK2LabTransform.forward(outputWhiteCMYK);
                    let outputWhiteLabCMYK = userIntentLab2CMYKTransform.forward(outputWhiteLab);

                    let transformedOutputWhiteCMYK = convert.CMYK(0, 0, 0, 0);
                    let transformedOutputWhiteLab = transformOutputDevice2Lab.forward(transformedOutputWhiteCMYK);
                    let transformedOutputWhiteLabCMYK = transformLab2OutputDevice.forward(transformedOutputWhiteLab);

                    let outputBlackCMYK = userIntentLab2CMYKTransform.forward(inputBlackLab);
                    let outputBlackLab = userIntentCMYK2LabTransform.forward(outputBlackCMYK);
                    let outputBlackLabCMYK = userIntentLab2CMYKTransform.forward(outputBlackLab);

                    let transformedOutputBlackCMYK = transformLab2OutputDevice.forward(inputBlackLab);
                    let transformedOutputBlackLab = transformOutputDevice2Lab.forward(outputBlackCMYK);
                    let transformedOutputBlackLabCMYK = transformLab2OutputDevice.forward(outputBlackLab);

                    let outputKOnlyBlackCMYK = convert.CMYK(0, 0, 0, 100);
                    let outputKOnlyBlackLab = userIntentCMYK2LabTransform.forward(outputKOnlyBlackCMYK);
                    let outputKOnlyBlackLabCMYK = userIntentLab2CMYKTransform.forward(outputKOnlyBlackLab);

                    if (
                        Math.abs(outputKOnlyBlackCMYK.K - outputBlackCMYK.K) < 0.00001
                        && Math.abs(outputKOnlyBlackCMYK.C - outputBlackCMYK.C) < 0.00001
                        && Math.abs(outputKOnlyBlackCMYK.M - outputBlackCMYK.M) < 0.00001
                        && Math.abs(outputKOnlyBlackCMYK.Y - outputBlackCMYK.Y) < 0.00001
                    ) {
                        effectiveKOnlyBlackpointCompensationScale = references.estimatedKOnlyBlackpointCompensationScale = 1;
                        // effectiveKOnlyBlackpointCompensationScaleReversed = references.effectiveKOnlyBlackpointCompensationScaleReversed =  1;
                    }

                    let transformedOutputKOnlyBlackCMYK = convert.CMYK(0, 0, 0, 100);
                    let transformedOutputKOnlyBlackLab = transformOutputDevice2Lab.forward(transformedOutputKOnlyBlackCMYK);
                    let transformedOutputKOnlyBlackLabCMYK = transformLab2OutputDevice.forward(transformedOutputKOnlyBlackLab);

                    let outputMaximumCMYK = convert.CMYK(100, 100, 100, 100);
                    let outputMaximumLab = userIntentCMYK2LabTransform.forward(outputMaximumCMYK);
                    let outputMaximumLabCMYK = userIntentLab2CMYKTransform.forward(outputMaximumLab);

                    let transformedOutputMaximumCMYK = convert.CMYK(100, 100, 100, 100);
                    let transformedOutputMaximumLab = transformOutputDevice2Lab.forward(transformedOutputMaximumCMYK);
                    let transformedOutputMaximumLabCMYK = transformLab2OutputDevice.forward(transformedOutputMaximumLab);

                    let scaledInputBlackLab = applyKOnlyBlackpointCompensation(inputBlackLab);
                    let scaledOutputWhiteLab = applyKOnlyBlackpointCompensation(outputWhiteLab);
                    let scaledOutputBlackLab = applyKOnlyBlackpointCompensation(outputBlackLab);
                    let scaledOutputKOnlyBlackLab = applyKOnlyBlackpointCompensation(outputKOnlyBlackLab);
                    let scaledOutputMaximumLab = applyKOnlyBlackpointCompensation(outputMaximumLab);

                    references.scaledOutputKOnlyBlackpointLab = outputKOnlyBlackLab;

                    let perceptuallyScaledInputBlackLab = applyPerceptualKOnlyBlackpointCompensation(inputBlackLab);
                    let perceptuallyScaledOutputWhiteLab = applyPerceptualKOnlyBlackpointCompensation(outputWhiteLab);
                    let perceptuallyScaledOutputBlackLab = applyPerceptualKOnlyBlackpointCompensation(outputBlackLab);
                    let perceptuallyScaledOutputKOnlyBlackLab = applyPerceptualKOnlyBlackpointCompensation(outputKOnlyBlackLab);
                    let perceptuallyScaledOutputMaximumLab = applyPerceptualKOnlyBlackpointCompensation(outputMaximumLab);

                    let revertedScaledInputBlackLab = revertKOnlyBlackpointCompensation(scaledInputBlackLab);
                    let revertedScaledOutputWhiteLab = revertKOnlyBlackpointCompensation(scaledOutputWhiteLab);
                    let revertedScaledOutputBlackLab = revertKOnlyBlackpointCompensation(scaledOutputBlackLab);
                    let revertedScaledOutputKOnlyBlackLab = revertKOnlyBlackpointCompensation(scaledOutputKOnlyBlackLab);
                    let revertedScaledOutputMaximumLab = revertKOnlyBlackpointCompensation(scaledOutputMaximumLab);

                    if (this.debugging?.kOnlyTables) console.table(Object.fromEntries([
                        100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80
                    ].sort().reverse().map(K => ([K, {
                        'G': roundN(relativeSourceRGB2LabTransform.forward(convert.RGB((100 - K) / 100 * 255, (100 - K) / 100 * 255, (100 - K) / 100 * 255)).L, 3),
                        'G-K': roundN(userIntentCMYK2LabTransform.forward(userIntentLab2CMYKTransform.forward(relativeSourceRGB2LabTransform.forward(convert.RGB((100 - K) / 100 * 255, (100 - K) / 100 * 255, (100 - K) / 100 * 255)))).L, 3),
                        'KOnly': roundN(userIntentCMYK2LabTransform.forward(convert.CMYK(0, 0, 0, K)).L, 3),
                        '∆KOnly/KOnly-K': roundN(userIntentCMYK2LabTransform.forward(convert.CMYK(0, 0, 0, K)).L - userIntentCMYK2LabTransform.forward(userIntentLab2CMYKTransform.forward(userIntentCMYK2LabTransform.forward(convert.CMYK(0, 0, 0, K)))).L, 3),
                    }]))));

                    if (this.debugging?.kOnlyTables) console.table({
                        prerceptualKOnlyBlackpointCompensationScale: references.prerceptualKOnlyBlackpointCompensationScale,
                        estimatedKOnlyBlackpointCompensationScale: references.estimatedKOnlyBlackpointCompensationScale,
                        effectiveKOnlyBlackpointCompensationScale,
                        effectiveKOnlyBlackpointCompensationScaleReversed,
                    });

                    if (this.debugging?.kOnlyTables) console.table(Object.fromEntries(Object.entries({
                        outputWhiteCMYK,
                        outputMaximumCMYK,
                        outputBlackCMYK,
                        outputKOnlyBlackCMYK,
                        outputWhiteLabCMYK,
                        outputBlackLabCMYK,
                        outputKOnlyBlackLabCMYK,
                        outputMaximumLabCMYK,
                        transformedOutputWhiteCMYK,
                        transformedOutputMaximumCMYK,
                        transformedOutputBlackCMYK,
                        transformedOutputKOnlyBlackCMYK,
                        transformedOutputWhiteLabCMYK,
                        transformedOutputBlackLabCMYK,
                        transformedOutputKOnlyBlackLabCMYK,
                        transformedOutputMaximumLabCMYK,
                    }).map(([key, { C, M, Y, K }]) => [key, { C: roundN(C, 2), M: roundN(M, 2), Y: roundN(Y, 2), K: roundN(K, 2) }])));

                    if (this.debugging?.kOnlyTables) console.table(Object.fromEntries(Object.entries({
                        legacyOutputInkLimitedBlackLab,
                        legacyOutputBlackLab,
                        legacyOutputDetectedBlackLab,
                        legacyOutputDetectedOutputBlackLab,
                        legacyOutputBlackPerceptualLab,
                        legacyOutputDetectedBlackPerceptualLab,
                        legacyOutputDetectedOutputBlackPerceptualLab,
                        estimatedBlackpointLab,
                        estimatedKOnlyBlackpointLab,
                        inputBlackLab,
                        perceptuallyScaledInputBlackLab,
                        scaledInputBlackLab,
                        revertedScaledInputBlackLab,
                        outputWhiteLab,
                        perceptuallyScaledOutputWhiteLab,
                        scaledOutputWhiteLab,
                        revertedScaledOutputWhiteLab,
                        transformedOutputWhiteLab,
                        outputBlackLab,
                        perceptuallyScaledOutputBlackLab,
                        scaledOutputBlackLab,
                        revertedScaledOutputBlackLab,
                        transformedOutputBlackLab,
                        outputKOnlyBlackLab,
                        perceptuallyScaledOutputKOnlyBlackLab,
                        scaledOutputKOnlyBlackLab,
                        revertedScaledOutputKOnlyBlackLab,
                        transformedOutputKOnlyBlackLab,
                        outputMaximumLab,
                        perceptuallyScaledOutputMaximumLab,
                        scaledOutputMaximumLab,
                        revertedScaledOutputMaximumLab,
                        transformedOutputMaximumLab,

                    }).map(([key, { L, a, b }]) => [key, { L: roundN(L, 2), a: roundN(a, 2), b: roundN(b, 2) }])));
                }

                references.effectiveKOnlyBlackpointCompensationScale = references.estimatedKOnlyBlackpointCompensationScale;

                if (this.debugging?.kOnlyTables) console.table(Object.fromEntries(Object.entries({
                    prerceptualBaselineBlackpointCompensationScale: references.prerceptualKOnlyBlackpointCompensationScale,
                    estimatedBlackpointCompensationScale: references.estimatedKOnlyBlackpointCompensationScale,
                    effectiveKOnlyBlackpointCompensationScale: references.effectiveKOnlyBlackpointCompensationScale,
                    estimatedBlackpointL: estimatedBlackpointLab.L,
                    prerceptualBlackpointL: references.effectivePerceptualDestinationBlackpointLab.L,
                    [`${userIntent}BlackpointL*`]: references[`${userIntent}DestinationBlackpointLab`].L,
                    estimatedKOnlyBlackpointL: estimatedKOnlyBlackpointLab?.L ?? NaN,
                    perceptualKOnlyBlackpointL: references.perceptualDestinationKOnlyBlackpointLab.L,
                    [`${userIntent}KOnlyBlackpointL*`]: references[`${userIntent}DestinationKOnlyBlackpointLab`].L,
                }).map(([key, value]) => [key, roundN(value, 3)])));

                return {
                    references,
                    applyKOnlyBlackpointCompensation,
                    isMaximumGCR,
                };
            })({
                outputIntent,
            });

        let position = 0, count = 0;

        if (isMaximumGCR) {
            console.log('Profile is already K-only blackpoint compensated. No need to create a K-only blackpoint compensated CLUT.');

            for (let r = 0; r < gridPoints; r++) {
                const rv = r * gridStep;
                for (let g = 0; g < gridPoints; g++) {
                    const gv = g * gridStep;
                    for (let b = 0; b < gridPoints; b++) {
                        const bv = b * gridStep;

                        if (this.verbose && (debugging_create3DDeviceLUT_KOnly) && count++ && !(count % 1000)) console.log({ count, position });

                        const inputRGB = rgbColor(rv, gv, bv);
                        const inputCMYK = transformInputDevice2OutputDevice.forward(inputRGB);
                        CLUT[position++] = inputCMYK.C / 100;
                        CLUT[position++] = inputCMYK.M / 100;
                        CLUT[position++] = inputCMYK.Y / 100;
                        CLUT[position++] = inputCMYK.K / 100;
                    }
                }
            }
        } else {

            const K_MAX = 99.5, K_MIN = 0.5;
            const CMY_MAX = K_MAX, CMY_MIN = K_MIN;

            for (let r = 0; r < gridPoints; r++) {
                const rv = r * gridStep;
                for (let g = 0; g < gridPoints; g++) {
                    const gv = g * gridStep;
                    for (let b = 0; b < gridPoints; b++) {
                        const bv = b * gridStep;

                        if (this.verbose && (debugging_create3DDeviceLUT_KOnly) && count++ && !(count % 1000)) console.log({ count, position });

                        // NOTE: Going from RGB to Lab to CMYK first and then CMYK to Lab does not work!
                        const inputRGB = rgbColor(rv, gv, bv);
                        const inputLab = transformInputDevice2Lab.forward(inputRGB);
                        const inputCMYK = transformLab2OutputDevice.forward(inputLab);
                        const inputChroma = (inputLab.a ** 2 + inputLab.b ** 2) ** 0.5;
                        const scaledLab = /** @type {import('./def.js')._cmsLab} */ (applyKOnlyBlackpointCompensation(inputLab));
                        const scaledCMYK = transformLab2OutputDevice.forward(scaledLab);

                        // Runtime debugging output (controlled by debugging.estimateKOnlyBlackpoint flag)
                        if (this.debugging?.estimateKOnlyBlackpoint) {
                            // Check if this is a test color we want to debug (neutral grays)
                            const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                            const shouldDebug = isDebugGray && (
                                Math.abs(rv - 0.000) < 0.001 ||  // Pure black RGB(0,0,0)
                                Math.abs(rv - 0.250) < 0.005 ||  // Dark gray RGB(64,64,64)
                                Math.abs(rv - 0.500) < 0.005 ||  // Medium gray RGB(128,128,128)
                                Math.abs(rv - 0.750) < 0.005     // Light gray RGB(192,192,192)
                            );

                            if (shouldDebug) {
                                // Will output stage-by-stage debug information
                                console.error(`\n[JS-DEBUG] === RGB(${rv.toFixed(3)}, ${gv.toFixed(3)}, ${bv.toFixed(3)}) ===`);
                                console.error(`[JS-DEBUG] Stage 1 - Input Lab: L=${inputLab.L.toFixed(2)} a=${inputLab.a.toFixed(6)} b=${inputLab.b.toFixed(6)}`);
                                console.error(`[JS-DEBUG] Stage 2 - Input Chroma: ${inputChroma.toFixed(6)}`);
                                console.error(`[JS-DEBUG] Stage 3 - BPC Scale: ${computedReferences.estimatedKOnlyBlackpointCompensationScale.toFixed(6)}`);
                                console.error(`[JS-DEBUG] Stage 3 - Scaled Lab after BPC: L=${scaledLab.L.toFixed(2)} a=${scaledLab.a.toFixed(2)} b=${scaledLab.b.toFixed(2)}`);
                                console.error(`[JS-DEBUG] Stage 3-verify - Scaled Lab (full precision): L=${scaledLab.L} a=${scaledLab.a} b=${scaledLab.b}`);
                                console.error(`[JS-DEBUG] Stage 4 - Scaled Lab→CMYK: C=${scaledCMYK.C.toFixed(2)} M=${scaledCMYK.M.toFixed(2)} Y=${scaledCMYK.Y.toFixed(2)} K=${scaledCMYK.K.toFixed(2)}`);
                                console.error(`[JS-DEBUG] Stage 4-verify - Scaled CMYK (full precision): C=${scaledCMYK.C} M=${scaledCMYK.M} Y=${scaledCMYK.Y} K=${scaledCMYK.K}`);
                            }
                        }

                        const normalizedChromaThreshold = 2;
                        const normalizedLab = { ...scaledLab, a: inputLab.a, b: inputLab.b };
                        const normalizedCMYK = transformLab2OutputDevice.forward(normalizedLab);

                        // Runtime debugging output
                        if (this.debugging?.estimateKOnlyBlackpoint) {
                            const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                            const shouldDebug = isDebugGray && (
                                Math.abs(rv - 0.000) < 0.001 ||
                                Math.abs(rv - 0.250) < 0.005 ||
                                Math.abs(rv - 0.500) < 0.005 ||
                                Math.abs(rv - 0.750) < 0.005
                            );
                            if (shouldDebug) {
                                console.error(`[JS-DEBUG] Stage 5a - Normalized Lab (BPC L* + original a*b*): L=${normalizedLab.L.toFixed(2)} a=${normalizedLab.a.toFixed(2)} b=${normalizedLab.b.toFixed(2)}`);
                                console.error(`[JS-DEBUG] Stage 5a-verify - Normalized Lab (full precision): L=${normalizedLab.L} a=${normalizedLab.a} b=${normalizedLab.b}`);
                                console.error(`[JS-DEBUG] Stage 5b - Normalized Lab→CMYK: C=${normalizedCMYK.C.toFixed(2)} M=${normalizedCMYK.M.toFixed(2)} Y=${normalizedCMYK.Y.toFixed(2)} K=${normalizedCMYK.K.toFixed(2)}`);
                                console.error(`[JS-DEBUG] Stage 5b-verify - Normalized CMYK (full precision): C=${normalizedCMYK.C} M=${normalizedCMYK.M} Y=${normalizedCMYK.Y} K=${normalizedCMYK.K}`);
                                console.error(`[JS-DEBUG] Stage 5b-compare - Same as scaledCMYK? ${normalizedCMYK === scaledCMYK} (should be false)`);
                            }
                        }

                        if (this.debugging?.traceBPCTransform && inputLab.L < 1.0) {
                            console.error(`[JS Normalized] Lab(${normalizedLab.L.toFixed(2)}, ${normalizedLab.a.toFixed(2)}, ${normalizedLab.b.toFixed(2)}) → CMYK(${normalizedCMYK.C.toFixed(2)}, ${normalizedCMYK.M.toFixed(2)}, ${normalizedCMYK.Y.toFixed(2)}, ${normalizedCMYK.K.toFixed(2)})`);
                        }

                        // For near-neutral colors (inputChroma < 0.5), treat as perfect neutral to avoid floating-point noise
                        const normalizedChroma = inputChroma < 0.5 ? 0 : (normalizedLab.a ** 2 + normalizedLab.b ** 2) ** 0.5;

                        const normalizedChromaFactor = Math.max(0, Math.min(1, (Math.log1p(normalizedChroma) / Math.log1p(5))));
                        const normalizedGrayComponent = Math.min(normalizedCMYK.C, normalizedCMYK.M, normalizedCMYK.Y, /* 100 - normalizedCMYK.K, */);

                        let outputCMYK = { ...normalizedCMYK };

                        {
                            let outputLab = { ...normalizedLab };

                            outputCMYK = {
                                ...outputCMYK,
                                // C: inputChroma > normalizedChromaThreshold ? Math.max(0, Math.min(100, (normalizedCMYK.C - normalizedGrayComponent) * normalizedChromaFactor)) : 0,
                                // M: inputChroma > normalizedChromaThreshold ? Math.max(0, Math.min(100, (normalizedCMYK.M - normalizedGrayComponent) * normalizedChromaFactor)) : 0,
                                // Y: inputChroma > normalizedChromaThreshold ? Math.max(0, Math.min(100, (normalizedCMYK.Y - normalizedGrayComponent) * normalizedChromaFactor)) : 0,
                                C: Math.max(0, Math.min(100, (normalizedCMYK.C - normalizedGrayComponent) * normalizedChromaFactor)),
                                M: Math.max(0, Math.min(100, (normalizedCMYK.M - normalizedGrayComponent) * normalizedChromaFactor)),
                                Y: Math.max(0, Math.min(100, (normalizedCMYK.Y - normalizedGrayComponent) * normalizedChromaFactor)),
                                K: Math.max(0, Math.min(100, normalizedCMYK.K + normalizedGrayComponent / 2)),
                            };

                            // Runtime debugging output
                            if (this.debugging?.estimateKOnlyBlackpoint) {
                                const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                                const shouldDebug = isDebugGray && (
                                    Math.abs(rv - 0.000) < 0.001 ||
                                    Math.abs(rv - 0.250) < 0.005 ||
                                    Math.abs(rv - 0.500) < 0.005 ||
                                    Math.abs(rv - 0.750) < 0.005
                                );
                                if (shouldDebug) {
                                    console.error(`[JS-DEBUG] Stage 5c - After GCR transformation: C=${outputCMYK.C.toFixed(2)} M=${outputCMYK.M.toFixed(2)} Y=${outputCMYK.Y.toFixed(2)} K=${outputCMYK.K.toFixed(2)}`);
                                }
                            }

                            let offsetK;

                            outputLab = transformOutputDevice2Lab.forward(outputCMYK);

                            const outputL = scaledLab.L;
                            let deltaL = 0, previousDeltaL = 0, previousL = outputLab.L;
                            let lMatchIterations = 0;

                            while (
                                lMatchIterations < MAX_L_MATCH_ITERATIONS
                                && Math.abs(deltaL = outputLab.L - outputL) > 0.125
                                && (previousDeltaL === 0 || Math.abs(previousDeltaL) > Math.abs(deltaL))
                            ) {
                                previousDeltaL = deltaL;
                                outputCMYK.K += outputLab.L > outputL ? -0.125 : 0.125;
                                outputLab = transformOutputDevice2Lab.forward(outputCMYK);
                                lMatchIterations++;
                            }

                            if (lMatchIterations >= MAX_L_MATCH_ITERATIONS && MAX_L_MATCH_ITERATIONS !== Infinity) {
                                console.warn(`[create3DDeviceLUT_KOnly] L-match loop hit max iterations (${MAX_L_MATCH_ITERATIONS}) at RGB(${(rv * 255).toFixed(0)}, ${(gv * 255).toFixed(0)}, ${(bv * 255).toFixed(0)})`);
                            }

                            // Runtime debugging output
                            if (this.debugging?.estimateKOnlyBlackpoint) {
                                const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                                const shouldDebug = isDebugGray && (
                                    Math.abs(rv - 0.000) < 0.001 ||
                                    Math.abs(rv - 0.250) < 0.005 ||
                                    Math.abs(rv - 0.500) < 0.005 ||
                                    Math.abs(rv - 0.750) < 0.005
                                );
                                if (shouldDebug) {
                                    console.error(`[JS-DEBUG] Stage 6 - After first L* matching (${lMatchIterations} iterations): K=${outputCMYK.K.toFixed(2)} (outputLab.L=${outputLab.L.toFixed(2)}, targetL=${outputL.toFixed(2)})`);
                                }
                            }

                            let outputChroma = (outputLab.a ** 2 + outputLab.b ** 2) ** 0.5;

                            {
                                const maxColor = Math.max(inputCMYK.C, inputCMYK.M, inputCMYK.Y);
                                const minColor = Math.min(inputCMYK.C, inputCMYK.M, inputCMYK.Y);
                                const primaryColor = inputCMYK.C === maxColor ? 'C' : inputCMYK.M === maxColor ? 'M' : 'Y';
                                const secondaryColor = primaryColor === 'C' ? (inputCMYK.M > inputCMYK.Y ? 'M' : 'Y') : (primaryColor === 'M' ? (inputCMYK.C > inputCMYK.Y ? 'C' : 'Y') : 'C');
                                const tertiaryColor = inputCMYK.C === minColor ? 'C' : inputCMYK.M === minColor ? 'M' : 'Y';

                                const primaryInput = inputCMYK[primaryColor],
                                    primaryNormalized = normalizedCMYK[primaryColor],
                                    primaryOutput = outputCMYK[primaryColor],
                                    primaryStep = (primaryInput - primaryOutput) / 100;
                                const secondaryInput = inputCMYK[secondaryColor],
                                    secondaryNormalized = normalizedCMYK[secondaryColor],
                                    secondaryOutput = outputCMYK[secondaryColor],
                                    secondaryStep = primaryStep / primaryInput * secondaryInput;

                                let nextPrimaryColor, nextSecondaryColor;
                                let primaryOffset = 0, secondaryOffset = 0;
                                const optimizedCMYK = { ...outputCMYK };
                                let optimizedLab = { ...outputLab };
                                let chromaOptimizationIterations = 0;

                                while (
                                    chromaOptimizationIterations < MAX_CHROMA_OPTIMIZATION_ITERATIONS
                                    && primaryStep !== 0
                                    && outputChroma > 1
                                    && inputChroma > 1
                                    && inputChroma - outputChroma > 0.5
                                    && !(nextPrimaryColor > inputCMYK[primaryColor] || nextPrimaryColor < 0 || nextSecondaryColor < 0)
                                ) {
                                    chromaOptimizationIterations++;
                                    previousL = optimizedLab.L;

                                    nextPrimaryColor = optimizedCMYK[primaryColor] + primaryStep;
                                    nextSecondaryColor = optimizedCMYK[secondaryColor] + secondaryStep;

                                    optimizedCMYK[primaryColor] = nextPrimaryColor;
                                    optimizedCMYK[secondaryColor] = nextSecondaryColor;

                                    optimizedLab = transformOutputDevice2Lab.forward(optimizedCMYK);

                                    let innerLMatchIterations = 0;
                                    while (
                                        innerLMatchIterations < MAX_INNER_L_MATCH_ITERATIONS
                                        && Math.abs((optimizedLab = transformOutputDevice2Lab.forward(optimizedCMYK)).L - outputL) > 0.125
                                        && Math.abs(deltaL) > Math.abs(deltaL = optimizedLab.L - outputL)
                                        && (previousDeltaL === 0 || (deltaL > 0 && previousDeltaL > 0) || (deltaL < 0 && previousDeltaL < 0))
                                    ) {
                                        previousDeltaL = deltaL;
                                        optimizedCMYK.K += optimizedLab.L > outputL ? -0.125 : 0.125;
                                        innerLMatchIterations++;
                                    }

                                    if (innerLMatchIterations >= MAX_INNER_L_MATCH_ITERATIONS && MAX_INNER_L_MATCH_ITERATIONS !== Infinity) {
                                        console.warn(`[create3DDeviceLUT_KOnly] Inner L-match loop hit max iterations (${MAX_INNER_L_MATCH_ITERATIONS}) at RGB(${(rv * 255).toFixed(0)}, ${(gv * 255).toFixed(0)}, ${(bv * 255).toFixed(0)}) during chroma optimization iteration ${chromaOptimizationIterations}`);
                                        break;
                                    }

                                    outputChroma = (optimizedLab.a ** 2 + optimizedLab.b ** 2) ** 0.5;
                                    if (nextPrimaryColor > inputCMYK[primaryColor] || nextPrimaryColor < 0 || nextSecondaryColor < 0) break;
                                }

                                if (chromaOptimizationIterations >= MAX_CHROMA_OPTIMIZATION_ITERATIONS && MAX_CHROMA_OPTIMIZATION_ITERATIONS !== Infinity) {
                                    console.warn(`[create3DDeviceLUT_KOnly] Chroma optimization loop hit max iterations (${MAX_CHROMA_OPTIMIZATION_ITERATIONS}) at RGB(${(rv * 255).toFixed(0)}, ${(gv * 255).toFixed(0)}, ${(bv * 255).toFixed(0)})`);
                                }

                                outputCMYK[primaryColor] = Math.min(optimizedCMYK[primaryColor], primaryInput);
                                outputCMYK[secondaryColor] = Math.min(optimizedCMYK[secondaryColor], secondaryInput);

                                // Runtime debugging output
                                if (this.debugging?.estimateKOnlyBlackpoint) {
                                    const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                                    const shouldDebug = isDebugGray && (
                                        Math.abs(rv - 0.000) < 0.001 ||
                                        Math.abs(rv - 0.250) < 0.005 ||
                                        Math.abs(rv - 0.500) < 0.005 ||
                                        Math.abs(rv - 0.750) < 0.005
                                    );
                                    if (shouldDebug) {
                                        console.error(`[JS-DEBUG] Stage 7 - After chroma restoration: K=${outputCMYK.K.toFixed(2)} (inputChroma=${inputChroma.toFixed(2)}, outputChroma=${outputChroma.toFixed(2)})`);
                                    }
                                }

                                let finalMatchIterations = 0;
                                const MAX_FINAL_L_MATCH_ITERATIONS = this.debugging?.disableLoopSafety ? Infinity : 1000;
                                while (
                                    finalMatchIterations < MAX_FINAL_L_MATCH_ITERATIONS
                                    && (Math.abs(outputLab.L - scaledLab.L) > 0.125)
                                    && outputLab.L >= scaledOutputKOnlyBlackpointLab.L
                                    && ((outputCMYK.K > 0 || offsetK > 0) && (outputCMYK.K < 100 || offsetK < 0))
                                ) {
                                    const deltaL = scaledLab.L - outputLab.L;
                                    const stepSize = Math.min(0.125, Math.abs(deltaL) / 2);
                                    const kAdjustment = deltaL > 0 ? -stepSize : stepSize;
                                    outputLab = transformOutputDevice2Lab.forward(outputCMYK = { ...outputCMYK, K: offsetK = outputCMYK.K + kAdjustment });
                                    finalMatchIterations++;
                                }

                                if (finalMatchIterations >= MAX_FINAL_L_MATCH_ITERATIONS && MAX_FINAL_L_MATCH_ITERATIONS !== Infinity) {
                                    console.warn(`[create3DDeviceLUT_KOnly] Final L-match loop hit max iterations (${MAX_FINAL_L_MATCH_ITERATIONS}) at RGB(${(rv * 255).toFixed(0)}, ${(gv * 255).toFixed(0)}, ${(bv * 255).toFixed(0)}). outputLab.L=${outputLab.L.toFixed(2)}, scaledLab.L=${scaledLab.L.toFixed(2)}, scaledOutputKOnlyBlackpointLab.L=${scaledOutputKOnlyBlackpointLab.L.toFixed(2)}, outputCMYK.K=${outputCMYK.K.toFixed(2)}`);
                                }

                                // Runtime debugging output
                                if (this.debugging?.estimateKOnlyBlackpoint) {
                                    const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                                    const shouldDebug = isDebugGray && (
                                        Math.abs(rv - 0.000) < 0.001 ||
                                        Math.abs(rv - 0.250) < 0.005 ||
                                        Math.abs(rv - 0.500) < 0.005 ||
                                        Math.abs(rv - 0.750) < 0.005
                                    );
                                    if (shouldDebug) {
                                        if (finalMatchIterations > 0) {
                                            console.error(`[JS-DEBUG] Stage 8 - After final L* matching (${finalMatchIterations} iterations): K=${outputCMYK.K.toFixed(2)} (outputLab.L=${outputLab.L.toFixed(2)}, targetL=${scaledLab.L.toFixed(2)})`);
                                        } else {
                                            console.error(`[JS-DEBUG] Stage 8 - Final L* matching SKIPPED (boundary/convergence conditions not met)`);
                                        }
                                    }
                                }
                            }
                        }

                        outputCMYK.K = outputCMYK.K >= K_MAX ? 100 : outputCMYK.K <= K_MIN ? 0 : outputCMYK.K;
                        outputCMYK.C = outputCMYK.K >= K_MAX ? 0 : outputCMYK.C >= CMY_MAX ? 100 : outputCMYK.C <= CMY_MIN ? 0 : outputCMYK.C;
                        outputCMYK.M = outputCMYK.K >= K_MAX ? 0 : outputCMYK.M >= CMY_MAX ? 100 : outputCMYK.M <= CMY_MIN ? 0 : outputCMYK.M;
                        outputCMYK.Y = outputCMYK.K >= K_MAX ? 0 : outputCMYK.Y >= CMY_MAX ? 100 : outputCMYK.Y <= CMY_MIN ? 0 : outputCMYK.Y;

                        // Runtime debugging output
                        if (this.debugging?.estimateKOnlyBlackpoint) {
                            const isDebugGray = Math.abs(rv - gv) < 0.001 && Math.abs(gv - bv) < 0.001;
                            const shouldDebug = isDebugGray && (
                                Math.abs(rv - 0.000) < 0.001 ||
                                Math.abs(rv - 0.250) < 0.005 ||
                                Math.abs(rv - 0.500) < 0.005 ||
                                Math.abs(rv - 0.750) < 0.005
                            );
                            if (shouldDebug) {
                                console.error(`[JS-DEBUG] FINAL OUTPUT: C=${outputCMYK.C.toFixed(2)} M=${outputCMYK.M.toFixed(2)} Y=${outputCMYK.Y.toFixed(2)} K=${outputCMYK.K.toFixed(2)}`);
                                console.error(`[JS-DEBUG] ===================================\n`);
                            }
                        }

                        CLUT[position++] = outputCMYK.C / 100, CLUT[position++] = outputCMYK.M / 100, CLUT[position++] = outputCMYK.Y / 100, CLUT[position++] = outputCMYK.K / 100;
                    }
                }
            }
        }

        if (this.verboseTiming || debugging_create3DDeviceLUT_KOnly) console.timeEnd('Creating 3D Device LUT');

        if (this.verbose || debugging_create3DDeviceLUT_KOnly) console.log('3D LUT size: %d points @ %d × %d × %d (Gray Component Replacement)', count, gridPoints, gridPoints, gridPoints);

        return CLUT;
    }

    /**
     * Apply sophisticated Gray Component Replacement (GCR) algorithm
     * @param {number[]} rgb - Input RGB values in device space [0-1]
     * @returns {number[]} CMYK values with GCR applied [0-1]
     */
    applyGrayComponentReplacement(rgb) {
        // Step 1: Transform RGB to Lab to check for neutrality
        const lab = this.transformRGBtoLab(rgb);
        const [L, a, b] = lab;

        // Step 2: Check if color is neutral (a* ≈ 0, b* ≈ 0)
        const isNeutral = Math.abs(a) < 2.0 && Math.abs(b) < 2.0;

        if (isNeutral) {
            // For neutral colors: Use only K channel, inversely proportional to L*
            // L* ranges from 0 (black) to 100 (white)
            // K should be 100% at L*=0 and 0% at L*=100
            const kValue = Math.max(0, Math.min(1, (100 - L) / 100));
            return [0, 0, 0, kValue]; // Only K channel
        } else {
            // For chromatic colors: Apply gray component replacement
            // Step 1: Get normal CMYK transformation
            const cmyk = this.forward(rgb);
            let [c, m, y, k] = cmyk;

            // Step 2: Calculate gray component (minimum of CMY)
            const grayComponent = Math.min(c, m, y);

            // Step 3: Remove gray component from CMY and add to K
            if (grayComponent > 0) {
                c = Math.max(0, c - grayComponent);
                m = Math.max(0, m - grayComponent);
                y = Math.max(0, y - grayComponent);
                k = Math.min(1, k + grayComponent);
            }

            // Step 4: Apply black point compression
            // Compress from potential 400% total ink to maximum 100% K
            const totalInk = c + m + y + k;
            if (totalInk > 1) {
                const compressionFactor = 1 / totalInk;
                c *= compressionFactor;
                m *= compressionFactor;
                y *= compressionFactor;
                k *= compressionFactor;
            }

            return [c, m, y, k];
        }
    }

    /**
     * Transform RGB to Lab color space for neutrality detection
     * Creates a temporary RGB to Lab pipeline if needed
     * @param {number[]} rgb - Input RGB values in device space [0-1]
     * @returns {number[]} Lab values [L*, a*, b*]
     */
    transformRGBtoLab(rgb) {
        // Use existing pipeline to transform RGB to Lab
        // This assumes the input profile is RGB-based
        // For a more robust implementation, we might need a dedicated RGB->Lab transform

        // Convert device RGB [0-1] to 8-bit for pipeline
        const rgb255 = rgb.map(v => Math.round(v * 255));

        // Create temporary Lab transform if we don't have one
        // For now, use a simplified approach assuming sRGB input
        // In a full implementation, this would use the actual input profile

        // Simplified sRGB to Lab conversion
        // This is an approximation - for production use, should use proper ICC profile transformation
        const [r, g, b] = rgb;

        // Convert sRGB to XYZ (simplified)
        const gamma = 2.2;
        const rLin = Math.pow(r, gamma);
        const gLin = Math.pow(g, gamma);
        const bLin = Math.pow(b, gamma);

        // sRGB to XYZ matrix (D65)
        const X = 0.4124 * rLin + 0.3576 * gLin + 0.1805 * bLin;
        const Y = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
        const Z = 0.0193 * rLin + 0.1192 * gLin + 0.9505 * bLin;

        // XYZ to Lab (D65 white point: 0.95047, 1.0, 1.08883)
        const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
        const fx = this.labF(X / Xn);
        const fy = this.labF(Y / Yn);
        const fz = this.labF(Z / Zn);

        const L = 116 * fy - 16;
        const a = 500 * (fx - fy);
        const bVal = 200 * (fy - fz);

        return [L, a, bVal];
    }

    /**
     * Lab f(t) function for XYZ to Lab conversion
     * @param {number} t - Input value
     * @returns {number} Transformed value
     */
    labF(t) {
        const delta = 6 / 29;
        if (t > delta * delta * delta) {
            return Math.pow(t, 1 / 3);
        } else {
            return t / (3 * delta * delta) + 4 / 29;
        }
    }

    /**
     * Generate the CLUT data for a 4D output device LUT (CMYK)
     * @param outputChannels - Number of output color channels
     * @param gridPoints - Number of grid points for the lookup table
     * @returns 4D device lookup table as Float32Array for CMYK transformations
     */
    create4DDeviceLUT(outputChannels, gridPoints) {
        return create4DDeviceLUT_legacy(this, outputChannels, gridPoints);
    }


    /**
     * Executes the color transformation pipeline on input color data
     * 
     * This is the primary execution method that processes colors through the complete
     * transformation pipeline. It corresponds to Little-CMS's cmsPipelineEval() function.
     * 
     * PIPELINE EXECUTION FLOW:
     * =======================
     * 1. Validates that pipeline has been created and is ready
     * 2. Iterates through each stage in sequence
     * 3. Calls each stage's transformation function with:
     *    - Current color data
     *    - Stage-specific parameters (stageData) 
     *    - Stage metadata for debugging
     * 4. Passes output of each stage as input to the next
     * 5. Returns final transformed color
     * 
     * DEBUGGING MODE:
     * ==============
     * When pipelineDebug is enabled:
     * - Records input/output of each stage in pipelineHistory[]
     * - Generates formatted debug output in debugHistory[]
     * - Allows inspection of transformation at each step
     * - Essential for troubleshooting transformation issues
     * 
     * PERFORMANCE OPTIMIZATION:
     * ========================
     * When debugging is disabled:
     * - Uses streamlined execution loop
     * - Minimal overhead between stages  
     * - Optimized for production performance
     * - No history or debug data collection
     * 
     * ERROR HANDLING:
     * ==============
     * - Throws exception if pipeline not created
     * - Stage functions can throw errors for invalid data
     * - Encoding mismatches caught during development
     * 
     * LITTLE-CMS PARALLEL:
     * ===================
     * This method directly parallels Little-CMS's:
     * - cmsPipelineEvalFloat() for floating-point pipelines
     * - cmsPipelineEval16() for 16-bit integer pipelines
     * - Same stage-by-stage execution model
     * - Similar error handling and validation
     * 
     * Note: Called Forward as there was a plan to build reverse pipelines automatically, 
     * but this is not currently supported.
     * 
     * @param {object|number[]} cmsColor - Input color data (format depends on pipeline configuration)
     * @returns {object|number[]} Transformed color data in output color space
     */
    forward(cmsColor) {

        if (!this.pipelineCreated) {
            throw new Error('No Pipeline');
        }

        var pipeline = this.pipeline;
        var len = pipeline.length;
        var newResult;
        var result = cmsColor;
        var i;
        var stage;
        if (
            this.pipelineDebug
            // || this.promoteGrayToCMYKBlack
        ) {
            // console.log('--- Pipeline Debug Start ---');
            this.pipelineHistory = [result];
            this.debugHistory = [];
            for (let i = 0; i < len; i++) {
                stage = pipeline[i];
                newResult = stage.funct.call(this, result, stage.stageData, stage);
                if (stage.debugFormat !== '') {
                    this.addDebugHistory(stage.debugFormat, stage.stageName, result, newResult);
                }
                this.pipelineHistory.push(newResult);
                result = newResult;
            }
        } else {
            for (let i = 0; i < len; i++) {
                result = pipeline[i].funct.call(this, result, pipeline[i].stageData, pipeline[i]);
            }
        }
        return result;
    };

    /**
     * Converts colors using the transformation pipeline
     * @param cmsColor - Input color object to transform
     * @returns Transformed color object in the output color space
     */
    transform(cmsColor) {
        return this.forward(cmsColor);
    }

    /**
     * An optimized fast transformer for converting 8bit imag data
     * Picks to fastest method based on input and output profiles
     *
     * TODO : Set input and output formats RGB, RGBA, CMYK, CMYKA, BGRA
     *
     * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray
     * @param {boolean} [inputHasAlpha] - Whether the input array has an alpha channel
     * @param {boolean} [outputHasAlpha] - Whether the output array has an alpha channel
     * @param {boolean} [preserveAlpha] - If true, the alpha channel is preserved, otherwise 
     *                                    it is discarded. If not spefified, it is set to 
     *                                    true if outputHasAlpha and inputHasAlpha true.
     * @param {number} [pixelCount] - Number of pixels to convert, if not specified, it 
     *                                 is calculated from inputArray length
     */
    transformArrayViaLUT(inputArray, inputHasAlpha = false, outputHasAlpha = false, preserveAlpha = outputHasAlpha && inputHasAlpha, pixelCount) {
        var lut = this.lut;
        if (!lut || !lut.CLUT)
            throw new Error('No LUT loaded');

        if (preserveAlpha === undefined) {
            preserveAlpha = outputHasAlpha && inputHasAlpha;
        }
        var inputBytesPerPixel = (inputHasAlpha) ? lut.inputChannels + 1 : lut.inputChannels;
        var outputBytesPerPixel = (outputHasAlpha) ? lut.outputChannels + 1 : lut.outputChannels;
        if (pixelCount === undefined) {
            pixelCount = Math.floor(inputArray.length / inputBytesPerPixel);
        }
        var outputArray = new Uint8ClampedArray(pixelCount * outputBytesPerPixel);
        var inputChannels = lut.inputChannels;
        var outputChannels = lut.outputChannels;

        switch (inputChannels) {
            case 1: // Gray / mono
                linearInterp1DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                break;

            case 2: // Duo tones
                this.bilinearInterp2DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                break;

            case 3: // RGB or Lab
                switch (outputChannels) {
                    case 3: // RGB > RGB or RGB > Lab
                        //if (lut.precision === 16) {
                        //    this.tetrahedralInterp3DArray_3Ch_loop_16bit(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha)
                        //} else {
                        this.tetrahedralInterp3DArray_3Ch_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        //}
                        break;
                    case 4: // RGB > CMYK
                        // if (lut.precision === 16) {
                        // this.tetrahedralInterp3DArray_4Ch_loop_16bit(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        // } else {
                        this.tetrahedralInterp3DArray_4Ch_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        // if (this.promoteGrayToCMYKBlack) {
                        //     // outputArray[0] = outputArray[0] > 99/255 ? 255 : outputArray[0] < 1 / 255 ? 0 : outputArray[0];
                        //     if (outputArray[0] < 2.55) outputArray[0] = 0;
                        //     if (outputArray[0] > 252.45) outputArray[0] = 255;
                        //     if (outputArray[1] < 2.55) outputArray[1] = 0;
                        //     if (outputArray[1] > 252.45) outputArray[1] = 255;
                        //     if (outputArray[2] < 2.55) outputArray[2] = 0;
                        //     if (outputArray[2] > 252.45) outputArray[2] = 255;
                        //     if (outputArray[3] < 2.55) outputArray[3] = 0;
                        //     if (outputArray[3] > 252.45) outputArray[3] = 255;

                        //     // console.log({outputArray})
                        //     // outputArray[0] *= outputArray[0] >= 2.55 && 1 || 0;
                        //     // outputArray[1] *= outputArray[1] >= 2.55 && 1 || 0;
                        //     // outputArray[2] *= outputArray[2] >= 2.55 && 1 || 0;
                        // }
                        // }
                        break;
                    default:
                        tetrahedralInterp3DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        break;
                }
                break;
            case 4: // CMYK
                switch (outputChannels) {
                    case 3: // CMYK > RGB or CMYK > Lab
                        this.tetrahedralInterp4DArray_3Ch_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        break;
                    case 4: // CMYK > CMYK
                        this.tetrahedralInterp4DArray_4Ch_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        // if (this.promoteGrayToCMYKBlack) {
                        //     // console.log({outputArray});
                        //     if (outputArray[0] < 2.55) outputArray[0] = 0;
                        //     if (outputArray[0] > 252.45) outputArray[0] = 255;
                        //     if (outputArray[1] < 2.55) outputArray[1] = 0;
                        //     if (outputArray[1] > 252.45) outputArray[1] = 255;
                        //     if (outputArray[2] < 2.55) outputArray[2] = 0;
                        //     if (outputArray[2] > 252.45) outputArray[2] = 255;
                        //     if (outputArray[3] < 2.55) outputArray[3] = 0;
                        //     if (outputArray[3] > 252.45) outputArray[3] = 255;

                        //     // outputArray[0] *= outputArray[0] >= 2.55 && 1 || 0;
                        //     // outputArray[1] *= outputArray[1] >= 2.55 && 1 || 0;
                        //     // outputArray[2] *= outputArray[2] >= 2.55 && 1 || 0;
                        // }
                        break;
                    default:
                        this.tetrahedralInterp4DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                        break;
                }
                break;
            default:
                throw new Error('Invalid inputChannels ' + inputChannels);
        }

        return outputArray;
    }

    /**
     * Converts colors using the transformation pipeline in an array format
     * 
     * TODO add a pixelFormat RGBA, RGB, CMYK, CMYKA, BGRA
     * 
     * @param inputArray - Input color array
     * @param {boolean} [inputHasAlpha] - Whether input array includes alpha channel
     * @param {boolean} [outputHasAlpha] - Whether output array should include alpha channel
     * @param {boolean} [preserveAlpha] - Whether to preserve alpha values during transformation
     * @param {number} [pixelCount] - Number of pixels in the array
     * @param {string} [outputFormat] - Output format (ignored if dataFormat is 'int8' and LUT is used)
     * @returns Transformed color array with processed pixel data
     */
    transformArray(inputArray, inputHasAlpha = false, outputHasAlpha = false, preserveAlpha = outputHasAlpha && inputHasAlpha, pixelCount, outputFormat) {

        if (!this.pipelineCreated) {
            throw new Error('No Pipeline');
        }

        if (this.dataFormat === 'int8' && this.lut !== false) {
            return this.transformArrayViaLUT(inputArray, inputHasAlpha, outputHasAlpha, preserveAlpha, pixelCount);
        }

        if (this.dataFormat === 'object' || this.dataFormat === 'objectFloat') {
            throw new Error('forwardArray can only be used with int8 or int16 dataFormat');
        }

        if (preserveAlpha && !inputHasAlpha) {
            throw new Error('preserveAlpha is true but inputArray has no alpha channel');
        }

        if (preserveAlpha === undefined) {
            preserveAlpha = outputHasAlpha && inputHasAlpha;
        }

        var pipeline = this.pipeline;
        var pipeLen = pipeline.length;
        var result;
        var s, o, i;
        var inputPos = 0;
        var outputPos = 0;
        var inputChannels;
        var outputChannels;
        var inputItemsPerPixel;
        var outputItemsPerPixel;
        var outputArray;

        /** 
         * @todo figure out why dataFormat object is not supported by transformArray 
         * @error This comparison appears to be unintentional because the types '"int8" | "int16" | "device"' and '"object"' have no overlap. (ts2367)
         */ // @ts-expect-error
        if (this.dataFormat === 'object' || this.dataFormat === 'objectFloat') {
            if (pixelCount === undefined) {
                pixelCount = inputArray.length;
            }
            outputArray = new Array(pixelCount);

            // Array of objects, so keep it simple
            for (let i = 0; i < pixelCount; i++) {
                result = inputArray[i];
                for (let s = 0; s < pipeLen; s++) {
                    result = pipeline[s].funct.call(this, result, pipeline[s].stageData, pipeline[s]);
                }
                outputArray[i] = result;
            }
            return outputArray;
        }

        inputChannels = this.inputChannels;
        outputChannels = this.outputChannels;
        inputItemsPerPixel = inputHasAlpha ? this.inputChannels + 1 : this.inputChannels;
        outputItemsPerPixel = (preserveAlpha) ? this.outputChannels + 1 : this.outputChannels;

        if (pixelCount === undefined) {
            pixelCount = Math.floor(inputArray.length / inputItemsPerPixel);
        }

        switch (outputFormat) {
            case 'int8':
                outputArray = new Uint8ClampedArray(pixelCount * outputItemsPerPixel);
                break;
            case 'int16':
                outputArray = new Uint16Array(pixelCount * outputItemsPerPixel);
                break;
            case 'float32':
                outputArray = new Float32Array(pixelCount * outputItemsPerPixel);
                break;
            case 'float64':
                outputArray = new Float64Array(pixelCount * outputItemsPerPixel);
                break;
            case 'same':
                // get input array type
                var inputArrayType = inputArray.constructor.name;
                switch (inputArrayType) {
                    case 'Uint8Array':
                        outputArray = new Uint8ClampedArray(pixelCount * outputItemsPerPixel);
                        break;
                    case 'Uint16Array':
                        outputArray = new Uint16Array(pixelCount * outputItemsPerPixel);
                        break;
                    case 'Float32Array':
                        outputArray = new Float32Array(pixelCount * outputItemsPerPixel);
                        break;
                    case 'Float64Array':
                        outputArray = new Float64Array(pixelCount * outputItemsPerPixel);
                        break;
                    default:
                        throw new Error('Unknown inputArray type ' + inputArrayType);
                }
                break;
            default:
                outputArray = new Array(pixelCount * outputItemsPerPixel);
        }



        switch (inputChannels) {
            case 1:
                for (let i = 0; i < pixelCount; i++) {
                    result = [inputArray[inputPos++]];
                    // loop though stages in the pipeline, result is updated every step
                    // This is NOT looping over pixels in an image, but looping over the stages in the pipeline
                    for (let s = 0; s < pipeLen; s++) {
                        result = pipeline[s].funct.call(this, result, pipeline[s].stageData, pipeline[s]);
                    }
                    for (let o = 0; o < outputChannels; o++) {
                        outputArray[outputPos++] = result[o];
                    }
                    if (preserveAlpha) {
                        outputArray[outputPos++] = inputArray[inputPos++];
                    } else {
                        if (inputHasAlpha) { inputPos++; }
                        if (outputHasAlpha) {
                            outputArray[outputPos++] = 255;
                        }
                    }
                }
                break;
            case 2:
                for (let i = 0; i < pixelCount; i++) {
                    result = [
                        inputArray[inputPos++],
                        inputArray[inputPos++],
                    ];
                    for (let s = 0; s < pipeLen; s++) {
                        result = pipeline[s].funct.call(this, result, pipeline[s].stageData, pipeline[s]);
                    }
                    for (let o = 0; o < outputChannels; o++) {
                        outputArray[outputPos++] = result[o];
                    }
                    if (preserveAlpha) {
                        outputArray[outputPos++] = inputArray[inputPos++];
                    } else {
                        if (inputHasAlpha) { inputPos++; }
                        if (outputHasAlpha) {
                            outputArray[outputPos++] = 255;
                        }
                    }
                }
                break;
            case 3:
                for (let i = 0; i < pixelCount; i++) {
                    result = [
                        inputArray[inputPos++],
                        inputArray[inputPos++],
                        inputArray[inputPos++],
                    ];
                    for (let s = 0; s < pipeLen; s++) {
                        result = pipeline[s].funct.call(this, result, pipeline[s].stageData, pipeline[s]);
                    }
                    for (let o = 0; o < outputChannels; o++) {
                        outputArray[outputPos++] = result[o];
                    }
                    if (preserveAlpha) {
                        outputArray[outputPos++] = inputArray[inputPos++];
                    } else {
                        if (inputHasAlpha) { inputPos++; }
                        if (outputHasAlpha) {
                            outputArray[outputPos++] = 255;
                        }
                    }
                }
                break;
            case 4:
                for (let i = 0; i < pixelCount; i++) {
                    result = [
                        inputArray[inputPos++],
                        inputArray[inputPos++],
                        inputArray[inputPos++],
                        inputArray[inputPos++],
                    ];
                    for (let s = 0; s < pipeLen; s++) {
                        result = pipeline[s].funct.call(this, result, pipeline[s].stageData, pipeline[s]);
                    }
                    for (let o = 0; o < outputChannels; o++) {
                        outputArray[outputPos++] = result[o];
                    }
                    if (preserveAlpha) {
                        outputArray[outputPos++] = inputArray[inputPos++];
                    } else {
                        if (inputHasAlpha) { inputPos++; }
                        if (outputHasAlpha) {
                            outputArray[outputPos++] = 255;
                        }
                    }
                }

        }
        return outputArray;
    };

    /**
     * Maps rendering intent to corresponding LUT index
     * @param {number} intent - Rendering intent value
     * @returns Corresponding LUT index for the specified rendering intent
     */
    intent2LUTIndex(intent) {
        // Absolute maps to relative LUT
        var LUTMap = [eIntent.perceptual, eIntent.relative, eIntent.saturation, eIntent.relative];
        return LUTMap[intent];
    };

    intent2String(intent) {
        return ['perceptual', 'relative', 'saturation', 'relative'][intent] || ('unknown ' + intent);
    };

    chainInfo() {
        var chainStr = '--------- PROFILE CHAIN ---------\n';
        for (var i = 0; i < this.chain.length; i++) {
            if (this.chain[i] instanceof Profile) {
                chainStr += 'Profile: ' + /** @type {Profile} */(this.chain[i]).name + '\n';
            } else {
                chainStr += 'Intent: ' + this.intent2String(this.chain[i]) + '\n';
            }
        }
        return chainStr;
    }

    historyInfo() {
        var tabWidth = 0;
        var history = ['--------- PIPELINE HISTORY ---------'];
        var i;

        // calculate the tab width
        for (let i = 0; i < this.debugHistory.length; i++) {
            if (this.debugHistory[i].indexOf('|') > tabWidth) {
                tabWidth = this.debugHistory[i].indexOf('|');
            }
        }

        for (let i = 0; i < this.debugHistory.length; i++) {
            var arr = this.debugHistory[i].split('|');
            if (arr.length > 1) {
                arr[0] = (arr[0] + ' . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .').substring(0, tabWidth) + ' ';
                arr[1] = arr[1].trim();
            }
            history.push(arr.join(''));
        }

        return history.join('\n');
    }

    optimizeInfo = function () {
        return this.optimizeDebug.join('\n');
    };

    debugInfo() {
        return this.chainInfo() + '\n\n' +
            this.optimizeInfo() + '\n\n' +
            this.getStageNames(true, false) +
            (this.pipelineDebug ? '\n\n' + this.historyInfo() : '');
    };

    /**
     * Generate descriptive names for all transformation pipeline stages
     * @param {boolean=} includeInputsAndOutputs - Include the input and output encoding in the stage name
     * @param {boolean=} includeDebugFormat - Include the debug format with the actual values in the stage name
     * @returns String representation of all pipeline stage names
     */
    getStageNames(includeInputsAndOutputs, includeDebugFormat) {
        var stageNames = [];
        var stageName;

        for (var i = 0; i < this.pipeline.length; i++) {
            if (includeInputsAndOutputs && this.pipeline[i].inputEncoding) {
                stageName = encodingStr[/** @type {encoding} */(this.pipeline[i].inputEncoding)] + ' > ' + this.pipeline[i].stageName + ' > ' + encodingStr[/** @type {encoding} */(this.pipeline[i].outputEncoding)];
            } else {
                stageName = this.pipeline[i].stageName;
            }

            if (includeDebugFormat) {
                stageName += ' ' + this.pipeline[i].debugFormat;
            }

            stageNames.push(i + ': ' + stageName);

        }
        return stageNames.join('\n');
    };

    /**
     * Creates the transformation pipeline from a chain of ICC profiles
     * 
     * This is the core method that builds the entire color transformation pipeline.
     * It mirrors Little-CMS's cmsPipeline concept, creating a series of stages that
     * transform colors from input device space through Profile Connection Space (PCS)
     * to output device space.
     * 
     * PIPELINE ARCHITECTURE (following Little-CMS model):
     * ==========================================
     * 
     * Input → Device → PCS → [Adaptation] → PCS → Device → Output
     * 
     * 1. INPUT TO DEVICE: Convert from color objects/arrays to device encoding (0.0-1.0)
     * 2. DEVICE TO PCS: Apply input profile transforms to reach Profile Connection Space
     * 3. PCS PROCESSING: Black Point Compensation, Chromatic Adaptation, Custom Stages
     * 4. PCS TO DEVICE: Apply output profile transforms from PCS to target device space
     * 5. DEVICE TO OUTPUT: Convert from device encoding to output color objects/arrays
     * 
     * LITTLE-CMS PARALLELS:
     * ====================
     * - Little-CMS: cmsPipeline → js-color-engine: Transform.pipeline[]
     * - Little-CMS: cmsStage → js-color-engine: _Stage objects
     * - Little-CMS: cmsPipelineInsertStage() → js-color-engine: addStage()
     * - Little-CMS: cmsPipelineEval() → js-color-engine: forward() method
     * 
     * PROFILE CONNECTION SPACE (PCS):
     * ==============================
     * The PCS serves as the "universal translator" between different color spaces.
     * All color transformations pass through PCS, typically as Lab or XYZ values
     * normalized to D50 illuminant. This allows any input profile to connect to
     * any output profile through the standardized PCS interchange format.
     * 
     * @param {(Profile|eIntent)[]} profileChain - Array alternating between profiles and intents [profile, intent, profile, intent, profile]
     * @param {boolean} convertInput - Whether to convert input encoding (object/int8/int16 → device)
     * @param {boolean} convertOutput - Whether to convert output encoding (device → object/int8/int16)  
     * @param {boolean} useCahcedLut - Whether to use precomputed lookup tables for faster transformation
     * @returns {void} Pipeline is built and stored in this.pipeline array
     */
    createPipeline(profileChain, convertInput, convertOutput, useCahcedLut) {

        this.pipeline = [];
        var chainEnd = profileChain.length - 1;


        // pcsInfo is used to keep track of the current encoding
        // and PCS space as we move through the pipeline
        //
        var pcsInfo = {
            /** @type {encoding?} */
            pcsEncoding: null,
        };

        if (this.pipelineDebug) {
            this.addStage(false, 'Start', this.stage_debug, '[PipeLine Input]| {data}', false);
        }

        ////////////////////////////////////////////////////////////////////
        //
        //  Step 1 - Convert from lab/rgb/cmyk objects to device encoding 0.0-1.0
        //  This is a unique feature of this library, as most other libraries
        //  will only handle 8bit or 16bit integer data.
        //

        //START!
        if (convertInput && this.dataFormat !== 'device') {
            if (!useCahcedLut) {
                this.insertCustomStage('beforeInput2Device', pcsInfo, false);
            }

            // Convert from the input cmsLab / cmsRGB / cmsCMYK to Device
            this.createPipeline_Input_to_Device(pcsInfo, /** @type {Profile} */(profileChain[0]));
        } else {
            // When using dataFormat='device' we do not need to convert from input to device
            pcsInfo.pcsEncoding = this.getInput2DevicePCSInfo(/** @type {Profile} */(profileChain[0]));
        }

        ////////////////////////////////////////////////////////////////////
        //
        //  If using the LUT crt the LUT only pipeline
        //
        if (useCahcedLut) {
            // Use prebuilt cached LUT - Faster but less accurate
            if (this.lut === false) {
                throw new Error('No LUT');
            }

            if (!Array.isArray(this.lut.chain)) {
                throw new Error('LUT has no profile chain');
            }

            if (this.lut.chain.length < 2) {
                throw new Error('LUT chain is too short');
            }

            // Get the input and output profiles from the LUT Chain
            var lutInputProfile = this.lut.chain[0];
            var lutOutputProfile = this.lut.chain[this.lut.chain.length - 1];

            if (!(lutInputProfile.hasOwnProperty('header') && lutInputProfile.hasOwnProperty('name'))) {
                throw new Error('LUT Chain does not start with a profile');
            }

            if (!(lutOutputProfile.hasOwnProperty('header') && lutOutputProfile.hasOwnProperty('name'))) {
                throw new Error('LUT Chain does not end with a profile');
            }

            this.createPipeline_Device_to_Device_via_LUT(pcsInfo, lutInputProfile, lutOutputProfile);

        } else {

            ////////////////////////////////////////////////////////////////////////
            //
            //   Link the profile chain, here we are linking the profiles together
            //   into one large pipeline, this is where the color conversion happens
            //   Note: each step in the chain it should start and end with
            //   pcsInfo.pcsEncoding = encoding.device
            //

            var stageIndex = 0;

            // [p1, intent, p2, intent, p3]
            // Calculate DeltaE [lab > perceptual > CMYK > relative > lab]
            // Simulate CMYK  [srgb > perceptual > CMYK > relative > srgb]
            for (var i = 0; i < profileChain.length - 1; i += 2) {
                var step = {
                    inputProfile: /** @type {Profile} */ (profileChain[i]),
                    intent: /** @type {eIntent} */ (profileChain[i + 1]),
                    outputProfile: /** @type {Profile} */ (profileChain[i + 2]),
                };

                this.insertCustomStage('beforeDevice2PCS', pcsInfo, stageIndex);

                ///////////////////////////////////////////////////////////////////////////////
                //
                // Step 2: Convert from Device[] to PCSv4[]
                //
                // Note if the input profile PCS is XYZ, it will be converted to PCSv4
                // If the output profile is also XYZ, then the optimizer will clean up
                //
                this.createPipeline_Device_to_PCS(pcsInfo, step.inputProfile, step.outputProfile, step.intent);

                this.insertCustomStage('afterDevice2PCS', pcsInfo, stageIndex);

                ///////////////////////////////////////////////////////////////////////////////
                //
                // Step 3: Apply Black Point Compensation to the PCS, by scaling in XYZ space
                //
                // - BPC does not apply to devicelink profiles (PCS not XYZ or Lab)
                // - BPC does not apply to absolute colorimetric intent
                // - BPC applies always on V4 perceptual and saturation intents
                //
                if (pcsInfo.pcsEncoding === encoding.PCSXYZ || pcsInfo.pcsEncoding === encoding.PCSv4 || pcsInfo.pcsEncoding === encoding.PCSv2) {
                    var useBPC;
                    if (Array.isArray(this.useBPC)) {
                        useBPC = this.useBPC[stageIndex];
                    } else {
                        useBPC = this.useBPC;
                    }

                    if (this._BPCAutoEnable) {
                        switch (step.intent) {
                            case eIntent.saturation:
                            case eIntent.perceptual:
                                //BPC applies always on V4 perceptual and saturation intents
                                if (step.inputProfile.version === 4 || step.outputProfile.version === 4) {
                                    useBPC = true;
                                }

                                //If gray TRC profile force BPC on to replicate LCMS Behavor
                                if (this.isGreyTRCwithNOLUT(step.inputProfile, step.intent)) {
                                    useBPC = true;
                                }

                                break;
                            case eIntent.absolute:
                                //BPC does not apply to absolute colorimetric intent
                                useBPC = false;
                        }
                    }

                    if (useBPC) {
                        this.createPipeline_BlackPointCompensation(pcsInfo, step.inputProfile, step.outputProfile, step.intent);
                    }

                    this.insertCustomStage('PCS', pcsInfo, stageIndex);

                    //
                    // Add Chromatic Adaptation is required
                    //
                    // this.createPipeline_chromaticAdaptation(pcsInfo, step.inputProfile, step.outputProfile, step.intent);
                    this.createPipeline_chromaticAdaptation(pcsInfo, step.inputProfile, step.outputProfile);
                }

                this.insertCustomStage('beforePCS2Device', pcsInfo, stageIndex);

                ///////////////////////////////////////////////////////////////////////////////
                //
                // Step 4: Convert from the PCSv4[] to Device[]
                //
                // If the output profiles PCS is XYZ, then the PCSv4 will be converted to XYZ
                //
                this.createPipeline_PCS_to_Device(pcsInfo, step.inputProfile, step.outputProfile, step.intent);

                this.insertCustomStage('afterPCS2Device', pcsInfo, stageIndex);

                stageIndex++;
            }
        }

        ///////////////////////////////////////////////////////////////////////////////
        //
        // Step 5: Convert from device encoding 0.0-1.0 to output lab/rgb/cmyk/int8 etc
        //
        if (convertOutput && this.dataFormat !== 'device') {
            // Convert from Output Device to outputFormat i.e cmsRGB / cmsLab
            this.createPipeline_Device_to_Output(pcsInfo, /** @type {Profile} */(profileChain[chainEnd]));

            if (!useCahcedLut) {
                this.insertCustomStage('afterDevice2Output', pcsInfo, false);
            }
        }

        if (this.pipelineDebug) {
            this.addStage(false, 'END', this.stage_debug, '[PipeLine Output]| {data}', false);
        }

        if (this.optimize) {
            // merge stages that can be merged
            this.optimizePipeline();
        }

        // Ensure pipeline is valid by checing that the output of one stage matches the input of the next
        this.verifyPipeline();
    };


    verifyPipeline() {
        var len = this.pipeline.length - 1;
        for (var i = 0; i < len; i++) {
            // info stages are just false
            if (this.pipeline[i].outputEncoding !== false && this.pipeline[i + 1].inputEncoding !== false) {

                if (typeof this.pipeline[i].funct !== 'function') {
                    throw new Error('No Function on stage @ ' + i + ' ' + this.pipeline[i].stageName);
                }

                if (this.pipeline[i].outputEncoding !== this.pipeline[i + 1].inputEncoding) {
                    console.log(this.getStageNames(true, true));
                    throw ('Incompatible Stages @ Stage ' + i + ' (' + this.pipeline[i].stageName + ' ' + encodingStr[/** @type {encoding} */(this.pipeline[i].outputEncoding)] + ' > ' + encodingStr[/** @type {encoding} */(this.pipeline[i + 1].inputEncoding)] + ' ' + this.pipeline[i + 1].stageName + ')');
                }
            }
        }
    };

    optimizePipeline() {
        var _this = this;
        var Opt = true;
        var startLength = this.pipeline.length;
        var beforePipeline = this.getStageNames();

        var interp3DList = [
            'linearInterp1D',
            'bilinearInterp2D',
            'trilinearInterp3D',
            'tetrahedralInterp3D',
            'trilinearInterp4D',
            'tetrahedralInterp4D',
        ];

        while (Opt === true) {
            Opt = false;

            // remove un-necessary conversion
            Opt ||= this.optimizeFindPattern('stage_null', false, function (stage1, stage2, stage0) {

                // Stage Nulls are used to keep track of the input and output encoding
                // so we need to update the input and output encoding of the next stage
                stage0.outputEncoding = stage2.inputEncoding;
                stage0.stageName += ' >> ALIAS ' + encodingStr[stage2.inputEncoding];
                stage0.optimized = true;

                // Still need to keep stage 2
                return [
                    stage2
                ];
            });

            // remove un-necessary conversion
            Opt ||= this.optimizeFindPattern('stage_LabD50_to_PCSv4', 'stage_PCSv4_to_LabD50', function () {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName);
                return [];
            });

            // remove un-necessary conversion
            Opt ||= this.optimizeFindPattern('stage_PCSv4_to_LabD50', 'stage_LabD50_to_PCSv4', function () {
                return [];
            });

            // remove un-necessary conversion
            Opt ||= this.optimizeFindPattern('stage_PCSv2_to_PCSv4', 'stage_PCSv4_to_PCSv2', function () {
                return [];
            });

            // remove un-necessary conversion
            Opt ||= this.optimizeFindPattern('stage_PCSv4_to_PCSv2', 'stage_PCSv2_to_PCSv4', function () {
                return [];
            });

            // remove un-necessary conversion
            Opt ||= this.optimizeFindPattern('stage_PCSXYZ_to_PCSv4', 'stage_PCSv4_to_PCSXYZ', function () {
                return [];
            });





            Opt ||= this.optimizeFindPattern('stage_PCSXYZ_to_PCSv4', 'stage_PCSv4_to_PCSv2', function (stage1, stage2) {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName);
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_PCSXYZ_to_PCSv2',
                    _this.stage_PCSXYZ_to_PCSv2,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });

            Opt ||= this.optimizeFindPattern('stage_LabD50_to_PCSv4', 'stage_PCSv4_to_PCSXYZ', function (stage1, stage2) {
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_LabD50_to_PCSXYZ',
                    _this.stage_LabD50_to_PCSXYZ,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });




            Opt ||= this.optimizeFindPattern('stage_PCSv2_to_PCSv4', 'stage_PCSv4_to_cmsLab', function (stage1, stage2) {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName + ' Replacing with stage_PCSv2_to_cmsLab');
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_PCSv2_to_cmsLab',
                    _this.stage_PCSv2_to_cmsLab,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });

            // Simplify conversion to one step
            Opt ||= this.optimizeFindPattern('stage_LabD50_to_PCSv2', 'stage_PCSv2_to_PCSv4', function (stage1, stage2) {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName + ' Replacing with stage_LabD50_to_PCSv4');
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_LabD50_to_PCSv4',
                    _this.stage_LabD50_to_PCSv4,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });

            // Simplify conversion to one step
            Opt ||= this.optimizeFindPattern('stage_LabD50_to_PCSv4', 'stage_PCSv4_to_PCSv2', function (stage1, stage2) {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName + ' Replacing with stage_LabD50_to_PCSv2');
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_LabD50_to_PCSv2',
                    _this.stage_LabD50_to_PCSv2,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });

            Opt ||= this.optimizeFindPattern('stage_LabD50_to_PCSv4', 'stage_PCSv4_to_cmsLab', function (stage1, stage2) {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName + ' Replacing with stage_LabD50_to_cmsLab');
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_LabD50_to_cmsLab',
                    _this.stage_LabD50_to_cmsLab,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });

            // Simplify conversion to one step
            Opt ||= this.optimizeFindPattern('stage_LabD50_to_PCSv2', 'stage_PCSv2_to_cmsLab', function (stage1, stage2) {
                //console.log('FOUND ' + stage1.stageName + ' and '  + stage2.stageName + ' Replacing with stage_LabD50_to_cmsLab');
                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_LabD50_to_cmsLab',
                    _this.stage_LabD50_to_cmsLab,
                    null,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });


            Opt ||= this.optimizeFindPattern('stage_matrix_rgb', 'stage_matrix_rgb', function (stage1, stage2) {

                // We need to scale the input down to PCSXYZ encoding to XYZ
                var inputMatrix_PCSXYZ = stage1.stageData;

                // And scale the output back from XYZ to PCSXYZ
                var outputMatrixInv_PCSXYZ = stage2.stageData;

                // Combine the matrices
                var combinedRGB_to_RGB_matrix = convert.multiplyMatrices(outputMatrixInv_PCSXYZ, inputMatrix_PCSXYZ);

                return [_this.createStage(
                    stage1.inputEncoding,
                    'stage_matrix_rgb',
                    _this.stage_matrix_rgb,
                    combinedRGB_to_RGB_matrix,
                    stage2.outputEncoding,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                )];
            });

            for (var i = 0; i < interp3DList.length; i++) {
                var interpND = interp3DList[i];
                // Simplify Int to LUT, we can use the LUT's inputscale directly instead of converting to device
                Opt ||= this.optimizeFindPattern('stage_Int_to_Device', interpND, function (stage1, stage2) {
                    var lut = stage2.stageData;
                    var intValue = stage1.stageData; // 255 or 65535
                    lut.inputScale = 1 / intValue;
                    return [_this.createStage(
                        stage1.inputEncoding,
                        interpND,
                        stage2.funct,
                        lut,
                        stage2.outputEncoding,
                        '  *[optimized : {name}]|({last}) > ({data})',
                        true
                    )];
                });

                // We can use the LUT's output directly instead of
                // This only saves a few multiplications and if statements, so not much of a saving
                Opt ||= this.optimizeFindPattern(interpND, 'stage_device_to_int', function (stage1, stage2) {
                    var lut = stage1.stageData;
                    var intValue = stage2.stageData; // 255 or 65535

                    lut.outputScale = lut.outputScale * intValue;
                    if (lut.outputScale > 0.99 && lut.outputScale < 1.01) {
                        //rounding errors
                        // 1 / 255 * 65535 / 255 = 1.007843137254902
                        // 1 / 65535 * 255 * 255 = 0.9922178988326849
                        lut.outputScale = 1;
                    }

                    var deviceToIntFunctionName = 'stage_device' + lut.outputChannels + '_to_int';

                    return [
                        _this.createStage(
                            stage1.inputEncoding,
                            interpND,
                            stage1.funct,
                            lut,
                            stage2.outputEncoding,
                            '  *[optimized : {name}]|({last}) > ({data})',
                            true
                        ),
                        _this.createStage(
                            stage2.outputEncoding,
                            deviceToIntFunctionName,
                            _this[deviceToIntFunctionName],
                            1,
                            stage2.outputEncoding,
                            '  *[optimized : {name}]|({last}) > ({data})',
                            true
                        )
                    ];
                });
            }
        }

        this.optimizeDebug = [
            '==========================================================================================',
            '** OPTIMISED PIPELINE - REMOVED ' + (startLength - this.pipeline.length) + ' STAGES **',
            'BEFORE OPTIMISE\n' + beforePipeline,
            '------------------------------------------------------------------------------------------',
            'AFTER OPTIMISE\n' + this.getStageNames(),
            '==========================================================================================',
        ];
    };

    /**
     * Finds and optimizes specific stage patterns in the transformation pipeline
     * @param {string} stageName1 - Name of the first stage to match
     * @param {string|false} StageName2 - Name of the second stage to match, or false for any
     * @param {function} replaceFunction - Function to execute when pattern is found
     * @returns Boolean indicating whether pattern was found and optimized
     */
    optimizeFindPattern(stageName1, StageName2, replaceFunction) {
        for (var i = 0; i < this.pipeline.length - 1; i++) {
            if (this.pipeline[i].stageName === stageName1 && (this.pipeline[i + 1].stageName === StageName2 || StageName2 === false)) {
                var previous = (i > 1) ? this.pipeline[i - 1] : false;
                var next = this.pipeline[i + 1];

                var insert = replaceFunction(this.pipeline[i], next, previous);

                // Remove the section and insert the replacement stages
                var first = this.pipeline.slice(0, i);
                var last = this.pipeline.slice(i + 2);
                this.pipeline = first.concat(insert, last);
                // we have to exit and try again later as we are out of sync
                return true;
            }
        }
        return false;
    };

    /**
     * Create a simplified pipeline using only the LUT 
     * Note that in the optimize path, if we are converting init8 and int16 we can use the LUT directly
     * and optimize out the conversion stages
     * @param pcsInfo
     * @param inputProfile
     * @param outputProfile
     */
    createPipeline_Device_to_Device_via_LUT(pcsInfo, inputProfile, outputProfile) {
        if (!this.lut) {
            throw new Error('No LUT');
        }

        switch (this.lut.inputChannels) {

            case 1: // Gray
                this.addStageLUT(
                    false,
                    this.getInput2DevicePCSInfo(inputProfile),
                    this.lut,
                    this.getDevice2OutputPCSInfo(outputProfile),
                    '  [Prebuilt LUT1D : {name}]|({last}) > ({data})'
                );
                break;

            case 2: // DuoTone
                this.addStageLUT(
                    false,
                    this.getInput2DevicePCSInfo(inputProfile),
                    this.lut,
                    this.getDevice2OutputPCSInfo(outputProfile),
                    '  [Prebuilt LUT2D : {name}]|({last}) > ({data})'
                );
                break;

            case 3: // RGB or Lab
                this.addStageLUT(
                    false,
                    this.getInput2DevicePCSInfo(inputProfile),
                    this.lut,
                    this.getDevice2OutputPCSInfo(outputProfile),
                    '  [Prebuilt LUT3D : {name}]|({last}) > ({data})'
                );
                break;

            case 4: // CMYK
                this.addStageLUT(
                    false,
                    this.getInput2DevicePCSInfo(inputProfile),
                    this.lut,
                    this.getDevice2OutputPCSInfo(outputProfile),
                    ' [Prebuilt LUT4D : {name}]|({last}) > ({data})'
                );
                break;
            default:
                throw new Error('Can not use Prebuilt LUT - Unknown LUT inputChannels ' + this.lut.inputChannels);
        }

        pcsInfo.pcsEncoding = this.getDevice2OutputPCSInfo(outputProfile);
    }


    /**
     * Creates pipeline stages to convert from input encoding to device color space
     * @param pcsInfo - Profile Connection Space information and state
     * @param {Profile} inputProfile - Input ICC profile with color space characteristics
     * @returns Pipeline stages for input to device color transformation
     */
    createPipeline_Input_to_Device(pcsInfo, inputProfile) {
        switch (inputProfile.type) {

            /////////////////////////////////////////////////////////////////////////////////////////////////

            case eProfileType.XYZ:
                this.addStage(
                    encoding.cmsXYZ,
                    'stage_XYZ_to_PCSXYZ',
                    this.stage_XYZ_to_PCSXYZ,
                    null,
                    encoding.PCSXYZ,
                    '  [Input2Device : XYZ : {name}]|({last}) > ({data})'
                );
                pcsInfo.pcsEncoding = encoding.PCSXYZ;
                break;
            case eProfileType.Lab:
                // Convert the input Lab to the input Profile whitePoint

                // Handle int8/int16 dataFormat - convert to Lab object first
                switch (this.dataFormat) {
                    case 'int8':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int8_to_Lab',
                            this.stage_Int8_to_Lab,
                            null,
                            encoding.cmsLab,
                            '  [int8 to Lab : Lab : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int16':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int16_to_Lab',
                            this.stage_Int16_to_Lab,
                            null,
                            encoding.cmsLab,
                            '  [int16 to Lab : Lab : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'object':
                    case 'objectFloat':
                    default:
                        // No conversion needed - input is already a Lab object
                        break;
                }

                if (this.labInputAdaptation) {
                    //
                    // Make sure that the input Lab is adapted to the PCS white point (D50)
                    // The lab values MUST have a whitepoint included or else will throw an error
                    // This allows you to use a Lab value with a whitepoint other than D50
                    //
                    this.addStage(
                        encoding.cmsLab,
                        'stage_cmsLab_to_LabD50',
                        this.stage_cmsLab_to_LabD50,
                        null,
                        encoding.LabD50,
                        '  [Input2Device : Lab : {name}]| ({last}) > ({data})'
                    );

                    this.addStage(
                        encoding.LabD50,
                        'stage_LabD50_to_PCSv4',
                        this.stage_LabD50_to_PCSv4,
                        null,
                        encoding.PCSv4,
                        '  [Input2Device : Lab : {name}]|({last}) > ({data})'
                    );
                } else {

                    this.addStage(
                        encoding.cmsLab,
                        'stage_LabD50_to_PCSv4',
                        this.stage_LabD50_to_PCSv4,
                        null,
                        encoding.PCSv4,
                        '  [Input2Device : Lab : {name}]|({last}) > ({data})'
                    );
                }

                pcsInfo.pcsEncoding = encoding.PCSv4;

                break;

            /////////////////////////////////////////////////////////////////////////////////////////////////
            case eProfileType.RGBMatrix:
                // Convert inputs to device array with range of 0.0 to 1.0
                pcsInfo.pcsEncoding = encoding.device;

                switch (this.dataFormat) {
                    case 'object':
                    case 'objectFloat':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_RGB_to_Device',
                            this.stage_RGB_to_Device,
                            null,
                            pcsInfo.pcsEncoding,
                            '  [Input2Device : RGBMatrix : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int8':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            255,
                            pcsInfo.pcsEncoding,
                            '  [int8 to Device : RGBMatrix : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int16':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            65535,
                            pcsInfo.pcsEncoding,
                            '  [int16 to Device : RGBMatrix : {name}]|({last}) > ({data})'
                        );
                        break;
                }
                break;

            /////////////////////////////////////////////////////////////////////////////////////////////////
            case eProfileType.Gray:

                pcsInfo.pcsEncoding = encoding.device;
                switch (this.dataFormat) {
                    case 'object':
                    case 'objectFloat':
                        this.addStage(
                            encoding.cmsRGB,
                            'stage_Gray_to_Device',
                            this.stage_Gray_to_Device,
                            null,
                            pcsInfo.pcsEncoding,
                            '  [Input2Device : Gray : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int8':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            255,
                            pcsInfo.pcsEncoding,
                            '  [in8 2Device : Gray : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int16':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            65535,
                            pcsInfo.pcsEncoding,
                            '  [in16 2Device : Gray : {name}]|({last}) > ({data})'
                        );
                        break;
                }
                break;

            /////////////////////////////////////////////////////////////////////////////////////////////////
            case eProfileType.Duo:

                pcsInfo.pcsEncoding = encoding.device;
                switch (this.dataFormat) {
                    case 'object':
                    case 'objectFloat':
                        this.addStage(
                            encoding.cmsRGB,
                            'stage_Duo_to_Device',
                            this.stage_Duo_to_Device,
                            null,
                            pcsInfo.pcsEncoding,
                            '  [Input2Device : Duo : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int8':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            255,
                            pcsInfo.pcsEncoding,
                            '  [in8 2Device : Duo : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int16':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            65535,
                            pcsInfo.pcsEncoding,
                            '  [in16 2Device : Duo : {name}]|({last}) > ({data})'
                        );
                        break;
                }
                break;


            /////////////////////////////////////////////////////////////////////////////////////////////////
            case eProfileType.RGBLut:
                // Convert inputs to device array with range of 0.0 to 1.0
                pcsInfo.pcsEncoding = encoding.device;

                switch (this.dataFormat) {
                    case 'object':
                    case 'objectFloat':
                        this.addStage(
                            encoding.cmsRGB,
                            'stage_RGB_to_Device',
                            this.stage_RGB_to_Device,
                            null,
                            pcsInfo.pcsEncoding,
                            '  [Input2Device : RGBLut : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int8':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            255,
                            pcsInfo.pcsEncoding,
                            '  [in8 2Device : RGBLut : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int16':
                        this.addStage(
                            encoding.cmsLab,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            65535,
                            pcsInfo.pcsEncoding,
                            '  [in16 2Device : RGBLut : {name}]|({last}) > ({data})'
                        );
                        break;
                }
                break;

            /////////////////////////////////////////////////////////////////////////////////////////////////
            case eProfileType.CMYK:
                // Convert inputs to device array with range of 0.0 to 1.0
                pcsInfo.pcsEncoding = encoding.device;
                switch (this.dataFormat) {
                    case 'object':
                    case 'objectFloat':
                        this.addStage(
                            encoding.cmsCMYK,
                            'stage_CMYK_to_Device',
                            this.stage_CMYK_to_Device,
                            null,
                            pcsInfo.pcsEncoding,
                            '  [Input2Device : CMYK : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int8':
                        this.addStage(
                            encoding.cmsCMYK,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            255,
                            pcsInfo.pcsEncoding,
                            '  [in8 2Device : CMYK : {name}]|({last}) > ({data})'
                        );
                        break;
                    case 'int16':
                        this.addStage(
                            encoding.cmsCMYK,
                            'stage_Int_to_Device',
                            this.stage_Int_to_Device,
                            65535,
                            pcsInfo.pcsEncoding,
                            '  [in16 2Device : CMYK : {name}]|({last}) > ({data})'
                        );
                        break;
                }
                break;
        }
    };

    getProfileChannels(profile) {
        switch (profile.type) {
            case eProfileType.Gray:
                return 1;
            case eProfileType.Duo:
                return 2;
            case eProfileType.XYZ:
            case eProfileType.Lab:
            case eProfileType.RGBMatrix:
            case eProfileType.RGBLut:
                return 3;
            case eProfileType.CMYK:
                return 4;
        }
        throw new Error('Unknown profile type ' + profile.type + 'in getProfileChannels');
    };

    getInput2DevicePCSInfo(inputProfile) {
        switch (inputProfile.type) {

            case eProfileType.Lab:
                return encoding.PCSv4;

            case eProfileType.XYZ:
                return encoding.PCSXYZ;

            case eProfileType.Gray:
            case eProfileType.Duo:
            case eProfileType.RGBMatrix:
            case eProfileType.RGBLut:
            case eProfileType.CMYK:
                return encoding.device;
        }
        throw new Error('Unknown profile type ' + inputProfile.type + 'in getInput2DevicePCSInfo');
    };

    getDevice2OutputPCSInfo(outputProfile) {
        switch (outputProfile.type) {
            case eProfileType.Lab:
                if (outputProfile.version === 2) {
                    return encoding.PCSv2;
                }
                return encoding.PCSv4;
            case eProfileType.XYZ:
                return encoding.PCSXYZ;
            case eProfileType.Gray:
            case eProfileType.Duo:
            case eProfileType.RGBMatrix:
            case eProfileType.RGBLut:
            case eProfileType.CMYK:
                return encoding.device;
        }
        throw new Error('Unknown profile type ' + outputProfile.type + 'in getDevice2OutputPCSInfo');
    };

    isGreyTRCwithNOLUT(profile, intent) {
        return (profile.Gray.kTRC && !profile.A2B[this.intent2LUTIndex(intent)]);
    }

    /**
     *
     * @param {CustomStage['location']} location
     * @param pcsInfo
     * @param stageIndex
     */
    insertCustomStage(location, pcsInfo, stageIndex) {
        if (this.customStages && this.customStages.length > 0) {
            for (var i = 0; i < this.customStages.length; i++) {
                var customStage = this.customStages[i];
                if (customStage.location === location) {
                    this.addStage(pcsInfo.pcsEncoding, 'Custom:' + customStage.description, customStage.stageFn, customStage.stageData, pcsInfo.pcsEncoding);
                }
                if (stageIndex !== false) {
                    if (customStage.location + '(' + stageIndex + ')' === location) {
                        this.addStage(pcsInfo.pcsEncoding, 'Custom:' + customStage.description, customStage.stageFn, customStage.stageData, pcsInfo.pcsEncoding);
                    }
                }
            }
        }
    }

    createPipeline_chromaticAdaptation(pcsInfo, inputProfile, outputProfile) {
        //
        // Not recommended per ICC but you can turn this on
        // https://www.color.org/whitepapers/ICC_White_Paper_6_v2_and_v4_display_profile_differences-updated.pdf
        //
        var doChromaticAdaptation = this.displayChromaticAdaptation;

        // Insert special cases here

        if (doChromaticAdaptation) {
            if (!convert.compareWhitePoints(inputProfile.mediaWhitePoint, outputProfile.mediaWhitePoint)) {

                this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);

                this.addStage(
                    encoding.PCSXYZ,
                    'stage_ChromaticAdaptation',
                    this.stage_chromaticAdaptation,
                    {
                        inputWhitePoint: inputProfile.mediaWhitePoint,
                        outputWhitePoint: outputProfile.mediaWhitePoint,
                    },
                    encoding.PCSXYZ,
                    '  [ChromaticAdaptation : {name}]|({last}) > ({data})'
                );
            }
        }
    };

    /**
     * Creates pipeline stages for Black Point Compensation (BPC)
     * 
     * BLACK POINT COMPENSATION THEORY:
     * ===============================
     * Black Point Compensation is a critical color management technique that adjusts
     * the dynamic range between input and output profiles. It ensures optimal use of
     * the available tonal range and prevents shadow clipping.
     * 
     * COLORIMETRIC FOUNDATION:
     * =======================
     * Every device has a "black point" - the darkest color it can reproduce. These
     * black points vary significantly between devices:
     * - Monitor black points: Very dark, often near 0.3 cd/m²
     * - Paper black points: Much lighter, limited by paper whiteness
     * - Printer black points: Vary with ink/media combinations
     * 
     * Without BPC, shadow detail can be lost when converting from devices with
     * darker black points to those with lighter black points.
     * 
     * ICC SPECIFICATION IMPLEMENTATION:
     * ================================
     * This implementation follows ICC's recommended BPC algorithm:
     * 1. Detect input and output device black points
     * 2. Calculate linear scaling transformation in XYZ space
     * 3. Apply scaling: Output = a × (Input - InputBlack) + OutputBlack
     * 
     * Mathematical Formula:
     * a = (OutputWhite - OutputBlack) / (InputWhite - InputBlack)
     * b = OutputBlack - a × InputBlack
     * 
     * Where white point is D50 standard: [0.9642, 1.0000, 0.8249]
     * 
     * LITTLE-CMS PARALLEL:
     * ===================
     * This corresponds to Little-CMS's _cmsReadFloatTag() for black point detection
     * and the BPC scaling implementation in cmsCreateExtendedTransform().
     * The same linear scaling mathematics are used.
     * 
     * RENDERING INTENT BEHAVIOR:
     * =========================
     * BPC application varies by rendering intent:
     * - Absolute Colorimetric: BPC disabled (maintains absolute values)
     * - Relative Colorimetric: BPC maps black points to preserve shadow detail
     * - Perceptual/Saturation: BPC automatically enabled in v4 profiles
     * 
     * QUALITY IMPACT:
     * ==============
     * Proper BPC prevents:
     * - Shadow clipping when printing
     * - Muddy or blocked shadows
     * - Loss of detail in dark regions
     * - Inconsistent tonal reproduction
     * 
     * @param {object} pcsInfo - Profile Connection Space state tracking
     * @param {Profile} inputProfile - Input ICC profile with source black point
     * @param {Profile} outputProfile - Output ICC profile with target black point  
     * @param {eIntent} intent - Rendering intent affecting BPC application
     * @returns {void} BPC stages added to pipeline if needed
     */
    createPipeline_BlackPointCompensation(pcsInfo, inputProfile, outputProfile, intent) {

        if (outputProfile.type === eProfileType.Duo || inputProfile.type === eProfileType.Duo) {
            // No BPC for Duotone
            return;
        }

        if (inputProfile.type === eProfileType.RGBMatrix && outputProfile.type === eProfileType.RGBMatrix) {
            // No BPC RGB Matrix > RGB Matrix transforms
            return;
        }

        // console.log({ outputProfile });

        var inputBlackXYZ = this.detectBlackpoint(inputProfile, intent);
        var outputBlackXYZ = this.detectOutputBlackpoint(outputProfile, intent);

        // console.log('createPipeline_chromaticAdaptation:', { inputBlackXYZ, outputBlackXYZ });

        // if (inputBlackXYZ !== false && outputBlackXYZ !== false) {
        if (inputBlackXYZ && outputBlackXYZ) {
            // Check if we need to do BPC, if blackpoints are the same then no BPC is needed
            var sameXYZ = (inputBlackXYZ.X === outputBlackXYZ.X &&
                inputBlackXYZ.Y === outputBlackXYZ.Y &&
                inputBlackXYZ.Z === outputBlackXYZ.Z);

            if (!sameXYZ) {
                // Convert from labPCS to XYZ
                this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);

                // Compute BlackPoint Compensation
                // This is a linear scaling in the form ax+b, where
                // a =   (bpout - D50) / (bpin - D50)
                // b = - D50* (bpout - bpin) / (bpin - D50)
                var ax, ay, az, bx, by, bz, tx, ty, tz;
                tx = inputBlackXYZ.X - 0.9642; // cms D50 X  0.9642
                ty = inputBlackXYZ.Y - 1.0000; // cms D50 Y  1.0
                tz = inputBlackXYZ.Z - 0.8249; // cms D50 Z  0.8249

                // scales
                ax = (outputBlackXYZ.X - 0.9642) / tx;
                ay = (outputBlackXYZ.Y - 1.0000) / ty;
                az = (outputBlackXYZ.Z - 0.8249) / tz;

                // offsets
                bx = - 0.9642 * (outputBlackXYZ.X - inputBlackXYZ.X) / tx;
                by = - 1.0000 * (outputBlackXYZ.Y - inputBlackXYZ.Y) / ty;
                bz = - 0.8249 * (outputBlackXYZ.Z - inputBlackXYZ.Z) / tz;

                var BPC = {
                    scale: {
                        X: ax,
                        Y: ay,
                        Z: az
                    },
                    offset: {
                        X: bx,
                        Y: by,
                        Z: bz
                    }
                };


                if (this.pipelineDebug) {
                    var d = this.debugHistoryDecimals;
                    this.addStage(
                        encoding.PCSXYZ,
                        'Black Point Info:',
                        this.stage_history,
                        +        '  [Black Point Info]   .................................  ' +
                        ' scale.ax = ' + ax.toFixed(d) + ' scale.ay = ' + ay.toFixed(d) + ' scale.az = ' + az.toFixed(d) +
                        ' offset.bx = ' + bx.toFixed(d) + ' offset.by = ' + by.toFixed(d) + ' offset.bz = ' + bz.toFixed(d),
                        encoding.PCSXYZ,
                        ''
                    );
                }

                ///////////////////////////////////////////
                // Apply BPC Scale
                this.addStage(
                    encoding.PCSXYZ,
                    'stage_BPC',
                    this.stage_ApplyBPCScale_PCSXYZ_to_PCSXYZ,
                    BPC,
                    encoding.PCSXYZ,
                    '  [BPC : ApplyBPCScale : {name}]| ({last}) > {data}'
                );

                pcsInfo.pcsEncoding = encoding.PCSXYZ;

                this.usesBPC = true;
            }
        }
    };

    /**
     * Creates pipeline stages to convert from device color space to Profile Connection Space (PCS)
     * 
     * This method implements the first half of the classic ICC color transformation workflow:
     * Device Space → Profile Connection Space (PCS)
     * 
     * DEVICE TO PCS TRANSFORMATION THEORY:
     * ===================================
     * Every ICC profile defines how to convert between its native device space (RGB, CMYK, etc.)
     * and the standardized Profile Connection Space. This transformation enables any input profile
     * to connect to any output profile through the common PCS "hub".
     * 
     * PCS serves as the "universal translator" - all colors pass through this standardized space,
     * typically as Lab or XYZ values normalized to D50 illuminant.
     * 
     * TRANSFORMATION METHODS BY PROFILE TYPE:
     * ======================================
     * 
     * RGBMatrix Profiles:
     * - Use mathematical matrix transformations
     * - Apply tone reproduction curves (TRC)
     * - Convert RGB → XYZ → PCS
     * - Fast, accurate for well-behaved displays
     * 
     * LUT-based Profiles (CMYK, RGB LUT, etc.):
     * - Use multi-dimensional lookup tables
     * - Support complex, non-linear device behavior
     * - Handle rendering intents (perceptual, relative, etc.)
     * - Essential for printing and specialized devices
     * 
     * Gray Profiles:
     * - Special case with single channel
     * - May use TRC curve or LUT depending on complexity
     * - Often requires black point compensation
     * 
     * Lab Profiles:
     * - Already in Lab space, may need white point adaptation
     * - Used for device-independent color specifications
     * 
     * LITTLE-CMS PARALLEL:
     * ===================
     * This corresponds to Little-CMS's _cmsReadInputLUT() and cmsCreateTransformTHR()
     * input processing stages. The same profile type dispatch and LUT vs Matrix
     * logic is used.
     * 
     * @param {object} pcsInfo - Profile Connection Space state tracking object
     * @param {Profile} inputProfile - Input ICC profile defining source device characteristics  
     * @param {Profile} outputProfile - Output ICC profile (used for context in some transforms)
     * @param {eIntent} intent - Rendering intent affecting LUT selection and processing
     * @returns {object} Updated pcsInfo with current encoding state
     */
    createPipeline_Device_to_PCS(pcsInfo, inputProfile, outputProfile, intent) {
        switch (inputProfile.type) {

            case eProfileType.Lab:
                this.createPipeline_Device_to_PCS_via_Lab(pcsInfo, inputProfile);
                break;

            case eProfileType.RGBMatrix:
                // this.createPipeline_Device_to_PCS_via_RGBMatrix(pcsInfo, inputProfile, outputProfile);
                this.createPipeline_Device_to_PCS_via_RGBMatrix(pcsInfo, inputProfile);
                break;

            case eProfileType.Gray:
                // special case , check for grayTRCTag and if it exists use it
                // if there is no LUT
                if (this.isGreyTRCwithNOLUT(inputProfile, intent)) {
                    //if(inputProfile.Gray.kTRC && !inputProfile.A2B[this.intent2LUTIndex(intent)]){
                    this.createPipeline_Gray_to_PCS(pcsInfo, inputProfile, outputProfile, intent);
                    return;
                }
            // Fall through to LUT

            case eProfileType.Duo:
            case eProfileType.RGBLut:
            case eProfileType.CMYK:
                if (inputProfile.version === 2) {
                    this.createPipeline_Device_to_PCS_via_V2Lut(pcsInfo, inputProfile, outputProfile, intent);
                } else {
                    this.createPipeline_Device_to_PCS_via_V4Lut(pcsInfo, inputProfile, outputProfile, intent);
                }
                break;

            default:
                throw new Error('Unknown profile type ' + inputProfile.type + 'in createPipeline_Device_to_PCS');
        }

        // Convert to PCSv4
        if (inputProfile.pcs === 'XYZ' && pcsInfo.pcsEncoding === encoding.PCSXYZ) {
            // Convert from XYZ to PCSv4
            this.addStage(
                encoding.PCSXYZ,
                'stage_PCSXYZ_to_PCSv4',
                this.stage_PCSXYZ_to_PCSv4,
                null,
                encoding.PCSv4,
                '  [PCSv4_to_Device : XYZ : {name}]|({last}) > ({data})'
            );
            pcsInfo.pcsEncoding = encoding.PCSv4;
        }

        return pcsInfo;
    };

    createPipeline_Device_to_PCS_via_Lab(pcsInfo, inputProfile) {

        //
        // Convert from a Lab profile to PCS
        //

        switch (inputProfile.pcs) {
            case 'XYZ':
                //
                // Ok, this is strange, a LAB profile with a
                // XYZ PCS, lets convert anyway
                //
                this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);
                break;
            case 'LAB':
                this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSv4);
                break;
            default:
                throw new Error('Unknown PCS ' + inputProfile.pcs + ' in createPipeline_Device_to_PCS_via_Lab');
        }
    }

    createPipeline_Device_to_PCS_via_RGBMatrix(pcsInfo, inputProfile) {

        if (pcsInfo.pcsEncoding !== encoding.device) {
            throw new Error('Device to PSC RGBMatrix expects device encoding');
        }

        if (this._expandRGBStages) {
            var inputMatrix = inputProfile.RGBMatrix.XYZMatrix;

            // We need to scale the input so the resulting conversion is in PCSXYZ scaling
            var inputMatrix_PCSXYZ = convert.matrixScaleValues(inputMatrix, 1 / u1Fixed15NumberMax);

            if (inputProfile.rgb.rTRC && inputProfile.rgb.rTRC.use) {
                // Use curves provided
                this.addStage(
                    encoding.device,
                    'stage_curves_v4',
                    this.stage_curves_v4,
                    [inputProfile.rgb.rTRC, inputProfile.rgb.gTRC, inputProfile.rgb.bTRC],
                    encoding.device,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                );
            } else {
                // Use Inverse Gamma function to convert RGB to linear
                this.addStage(
                    encoding.device,
                    'stage_Gamma_Inverse',
                    this.stage_Gamma_Inverse,
                    inputProfile.RGBMatrix,
                    encoding.device,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                );
            }

            // do the combined conversion
            this.addStage(
                encoding.device,
                'stage_matrix_rgb',
                this.stage_matrix_rgb,
                inputMatrix_PCSXYZ,
                encoding.PCSXYZ,
                '  *[optimized : {name}]|({last}) > ({data})',
                true
            );
            pcsInfo.pcsEncoding = encoding.PCSXYZ;

        } else {
            this.addStage(
                encoding.device,
                'stage_RGBDevice_to_PCSv4',
                this.stage_RGBDevice_to_PCSv4,
                inputProfile,
                encoding.PCSXYZ,
                '  [DevicetoPCS : RGBMatrix : {name}]|({last}) > ({data})'
            );

            pcsInfo.pcsEncoding = encoding.PCSXYZ;
        }
    }


    /**
     * Converts from device [0.0-1.0, 0.0-1.0,... ] to PCSv4 using the Input Profile
     * If the PCS is XYZ then we convert to PCSv4
     * @param pcsInfo
     * @param inputProfile
     * @param outputProfile
     * @param intent
     */
    createPipeline_Device_to_PCS_via_V2Lut(pcsInfo, inputProfile, outputProfile, intent) {
        if (pcsInfo.pcsEncoding !== encoding.device) {
            console.log(this.getStageNames(true));
            throw new Error('createPipeline_Version2_CH4toPCSv4: expects device encoding not ' + encodingStr[pcsInfo.pcsEncoding]);
        }

        var lut = inputProfile.A2B[this.intent2LUTIndex(intent)];

        // V2 Profile pipeline

        // Input curve into lut
        this.addStage(
            encoding.device,
            'stage_curve_v2',
            this.stage_curve_v2,
            lut.inputCurve,
            encoding.device,
            '  [V2_Device_to_PCSv4 : {name}]| ({last}) > ({data})'
        );

        //
        // When we transform via the LUT we end up with the profiles PCS
        //
        if (inputProfile.pcs === 'XYZ') {
            pcsInfo.pcsEncoding = encoding.PCSXYZ;
        } else {
            pcsInfo.pcsEncoding = (inputProfile.PCSDecode === 2) ? encoding.PCSv2 : encoding.PCSv4;
        }

        switch (lut.inputChannels) {
            case 1:
            case 2:
            case 3:
            case 4:
                this.addStageLUT(
                    false,
                    encoding.device,
                    lut,
                    pcsInfo.pcsEncoding, // Converted to PCSXYZ, or PCSv2 or PCSv4
                    '  [V2_Device_to_PCSv4 : {name}]|({last}) > ({data})'
                );
                break;
            default:
                throw new Error('UnSupported number of Input Channels ' + lut.inputChannels);
        }

        //
        // Output Curve from LUT to device
        //
        this.addStage(
            pcsInfo.pcsEncoding,
            'stage_curve_v2',
            this.stage_curve_v2,
            lut.outputCurve,
            pcsInfo.pcsEncoding,
            '  [V2_Device_to_PCSv4 : {name}]|({last}) > ({data}) ({data:f>16})'
        );

        //... now in PCSv2 encoding....

        // Convert if absolute intent
        this.createPipeline_Absolute_Adaptation_Input(pcsInfo, inputProfile, intent);

        // Returns any PCS
    };

    createPipeline_Device_to_PCS_via_V4Lut(pcsInfo, inputProfile, outputProfile, intent) {
        if (pcsInfo.pcsEncoding !== encoding.device) {
            console.log(this.getStageNames(true));
            throw new Error('V4_CH4_to_PCSv4: expects device encoding not ' + encodingStr[pcsInfo.pcsEncoding]);
        }

        var lut = inputProfile.A2B[this.intent2LUTIndex(intent)];

        if (!lut) {
            throw new Error('No LUT in createPipeline_Device_to_PCS_via_V4Lut for the intent ' + intent);
        }

        // A Curve
        if (lut.aCurves !== false && !this.isPassThrough(lut.aCurves)) {
            this.addStage(
                encoding.device,
                'stage_curves_v4',
                this.stage_curves_v4,
                lut.aCurves,
                encoding.device,
                '  [V4_Device_to_PCSv4 : aCurves : {name}]|({last}) > ({data}) ({data:f>16})'
            );
        }

        if (inputProfile.pcs === 'XYZ') {
            pcsInfo.pcsEncoding = encoding.PCSXYZ;
        } else {
            pcsInfo.pcsEncoding = encoding.PCSv4;
        }

        // CLUT
        if (lut.CLUT4 !== false) {
            switch (lut.inputChannels) {
                case 1:
                case 2:
                case 3:
                case 4:
                    this.addStageLUT(
                        false,
                        encoding.device, // Device in
                        lut,
                        pcsInfo.pcsEncoding, // PCSV4 or XYZ out
                        '  [V4_Device_to_PCSv4 : {name}]|({last}) > ({data})'
                    );
                    break;
                default:
                    throw new Error('Unsupported number of Output Channels');
            }
        }

        //M Curves
        if (lut.mCurves !== false && !this.isPassThrough(lut.mCurves)) {
            this.addStage(
                pcsInfo.pcsEncoding,
                'stage_curves_v4',
                this.stage_curves_v4,
                lut.mCurves,
                pcsInfo.pcsEncoding,
                '  [V4_Device_to_PCSv4 : mCurves : {name}]|({last}) > ({data}) ({data:f>16})'
            );
        }

        //M Matrix
        if (lut.matrix !== false) {
            if (!this.isIdentityMatrix(lut.matrix)) {
                this.addStage(
                    pcsInfo.pcsEncoding,
                    'stage_Matrix',
                    (this.matrixHasOffsets(lut.matrix)) ? this.stage_matrix_v4 : this.stage_matrix_v4_noOffsets,
                    lut.matrix,
                    pcsInfo.pcsEncoding,
                    '  [V4_Device_to_PCSv4 : Matrix : {name}]|({last}) > ({data}) ({data:f>16})'
                );
            }
        }
        if (lut.bCurves !== false && !this.isPassThrough(lut.bCurves)) {
            this.addStage(
                pcsInfo.pcsEncoding,
                'stage_curves_v4',
                this.stage_curves_v4,
                lut.bCurves,
                pcsInfo.pcsEncoding,
                '  [V4_Device_to_PCSv4 : bCurves : {name}]|({last}) > ({data}) ({data:f>16})'
            );
        }

        // convert if absolute
        this.createPipeline_Absolute_Adaptation_Input(pcsInfo, inputProfile, intent);

        //Returns PCS any
    };

    createPipeline_Gray_to_PCS(pcsInfo, inputProfile, outputProfile, intent) {
        if (pcsInfo.pcsEncoding !== encoding.device) {
            console.log(this.getStageNames(true));
            throw new Error('Gray_to_PCSv4: expects device encoding not ' + encodingStr[pcsInfo.pcsEncoding]);
        }

        if (inputProfile.pcs === 'XYZ') {

            // Convert to PCSXYZ
            this.addStage(
                encoding.device,
                'stage_grayTRC_to_PCSXYZ_Via_Y',
                this.stage_grayTRC_to_PCSXYZ_Via_Y,
                [inputProfile.Gray.kTRC],
                encoding.PCSXYZ,
                '  [Gray_to_PCSv4 : {name}]|({last}) > ({data}) ({data:f>16})'
            );

            // Convert if absolute intent
            if (intent === eIntent.absolute) {
                this.addStage(
                    encoding.PCSXYZ,
                    'stage_absoluteAdaptationIn_PCSXYZ_to_PCSXYZ',
                    this.stage_absoluteAdaptationIn_PCSXYZ_to_PCSXYZ,
                    inputProfile,
                    encoding.PCSXYZ,
                    '  [Gray_to_PCSv4 : {name}]|({last}) > ({data}) ({data:f>16})'
                );
            }

            pcsInfo.pcsEncoding = encoding.PCSXYZ;

        } else {
            // PCS LAB
            // Convert from Gray to PCS, Basically Map Gray to Luminance
            this.addStage(
                encoding.device,
                'stage_curves_v4',
                this.stage_grayTRC_to_PCSV4_Via_L,
                [inputProfile.Gray.kTRC],
                encoding.PCSv4,
                '  [Gray_to_PCSv4 : {name}]|({last}) > ({data}) ({data:f>16})'
            );
            pcsInfo.pcsEncoding = encoding.PCSv4;

            // Convert if absolute intent
            this.createPipeline_Absolute_Adaptation_Input(pcsInfo, inputProfile, intent);
        }
    };

    isPassThrough(curves) {
        var passThrough = true;
        // console.log({ curves });
        for (var i = 0; i < curves.length; i++) {
            passThrough = passThrough && curves[i].passThrough;
        }
        return passThrough;
    };

    /**
     * Pipeline to convert from the PCS encoded
     * @param pcsInfo
     * @param {Profile} inputProfile
     * @param {Profile} outputProfile
     * @param {number} intent
     */
    createPipeline_PCS_to_Device(pcsInfo, inputProfile, outputProfile, intent) {
        if (!(pcsInfo.pcsEncoding !== encoding.PCSv4 || pcsInfo.pcsEncoding !== encoding.PCSXYZ)) {
            console.log(this.getStageNames(true));
            throw new Error('createPipeline_PCS_to_Device: expects PCSv4 or PCSXYZ not ' + encodingStr[pcsInfo.pcsEncoding]);
        }

        switch (outputProfile.type) {
            case eProfileType.Lab:
                this.createPipeline_PCS_to_Lab(pcsInfo);
                return;

            case eProfileType.RGBMatrix:
                this.createPipeline_PCS_to_Device_via_RGBMatrix(pcsInfo, inputProfile, outputProfile);
                return;

            case eProfileType.Gray:
                // special case , check for grayTRCTag
                // else fall through to using LUT
                if (this.isGreyTRCwithNOLUT(outputProfile, intent)) {
                    this.createPipeline_PCS_to_Gray_via_kTRC(pcsInfo, inputProfile, outputProfile, intent);
                    return;
                }

            // Fall through to LUT
            case eProfileType.Duo:
            case eProfileType.RGBLut:
            case eProfileType.CMYK:
                if (outputProfile.version === 2) {
                    this.createPipeline_PCS_to_Device_via_V2LUT(pcsInfo, inputProfile, outputProfile, intent);
                    return;
                }

                this.createPipeline_PCS_to_Device_via_V4LUT(pcsInfo, inputProfile, outputProfile, intent);
                return;

            default:
                throw new Error('Unknown profile type ' + outputProfile.type + 'in createPipeline_PCS_to_Device');
        }
    };

    createPipeline_PCS_to_Lab(pcsInfo) {
        this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSv4);
    }

    createPipeline_PCS_to_Device_via_RGBMatrix(pcsInfo, inputProfile, outputProfile) {

        if (this._expandRGBStages) {
            var outputMatrixInv = outputProfile.RGBMatrix.XYZMatrixInv;

            // We need to scale the matrix by XYZ>XYZPCS
            var outputMatrixInv_PCSXYZ = convert.matrixScaleValues(outputMatrixInv, u1Fixed15NumberMax);

            this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);

            this.addStage(
                encoding.PCSXYZ,
                'stage_matrix_rgb',
                this.stage_matrix_rgb,
                outputMatrixInv_PCSXYZ,
                encoding.device,
                '  *[PCS_to_RGBDevice : {name}]|({last}) > ({data})',
                true
            );

            if (outputProfile.rgb.rTRCInv && outputProfile.rgb.rTRCInv.use) {
                // Use curves provided might also be parametric fn
                this.addStage(
                    encoding.device,
                    'stage_curves_v4',
                    this.stage_curves_v4,
                    [outputProfile.rgb.rTRCInv, outputProfile.rgb.gTRCInv, outputProfile.rgb.bTRCInv],
                    encoding.device,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                );
            } else {
                // Use Gamma function to adjust to output
                this.addStage(
                    encoding.device,
                    'stage_Gamma',
                    this.stage_Gamma,
                    outputProfile.RGBMatrix,
                    encoding.device,
                    '  *[optimized : {name}]|({last}) > ({data})',
                    true
                );
            }
        } else {

            this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSv4);

            this.addStage(
                encoding.PCSv4,
                'stage_PCSv4_to_RGBDevice',
                this.stage_PCSv4_to_RGBDevice,
                outputProfile,
                encoding.device,
                '  [PCS_to_RGBDevice : {name}]|({last}) > ({data})'
            );
        }

        pcsInfo.pcsEncoding = encoding.device;

    }

    createPipeline_PCS_to_Device_via_V4LUT(pcsInfo, inputProfile, outputProfile, intent) {

        // if Absolute Colorimetric then apply Adaptation here
        this.createPipeline_Absolute_Adaptation_Output_Any_to_PCSv4(pcsInfo, outputProfile, intent);

        var lut = outputProfile.B2A[this.intent2LUTIndex(intent)];

        // ensure the PCS is the correct Format and correct Version
        this.pipelineConvert_PCSV4_to_OutputProfile_PCS(pcsInfo, lut, outputProfile);

        // PCS is now PCSv2 or PCSXYZ

        // B Curves
        if (
            // lut.bCurves !== undefined && 
            lut.bCurves !== false && !this.isPassThrough(lut.bCurves)) {
            this.addStage(
                pcsInfo.pcsEncoding,
                'stage_curves_v4',
                this.stage_curves_v4,
                lut.bCurves,
                pcsInfo.pcsEncoding,
                '  [PCSv4_to_Device_via_V4LUT : bCurves : {name}]|({last}) > ({data}) ({data:f>16})'
            );
        }

        //M Matrix
        if (lut.matrix !== false) {
            if (!this.isIdentityMatrix(lut.matrix)) {
                this.addStage(
                    pcsInfo.pcsEncoding,
                    'stage_Matrix',
                    (this.matrixHasOffsets(lut.matrix)) ? this.stage_matrix_v4 : this.stage_matrix_v4_noOffsets,
                    lut.matrix,
                    pcsInfo.pcsEncoding,
                    '  [PCSv4_to_Device_via_V4LUT : Matrix : {name}]|({last}) > ({data}) ({data:f>16})'
                );
            }
        }

        //M Curves
        if (
            // lut.mCurves !== undefined && 
            lut.mCurves !== false && !this.isPassThrough(lut.mCurves)) {
            this.addStage(
                pcsInfo.pcsEncoding,
                'stage_curves_v4',
                this.stage_curves_v4,
                lut.mCurves,
                pcsInfo.pcsEncoding,
                '  [PCSv4_to_Device_via_V4LUT : mCurves : {name}]|({last}) > ({data}) ({data:f>16})'
            );
        }

        // CLUT - PCS is always 3 channel input
        if (
            // lut.CLUT4 !== undefined && 
            lut.CLUT4 !== false) {
            this.addStageLUT(
                true,
                pcsInfo.pcsEncoding,
                lut,
                encoding.device,
                '  [PCSv4_to_Device_via_V4LUT : LUT : {name}]|({last}) > ({data})'
            );
        } else {
            pcsInfo.pcsEncoding = encoding.device;
        }

        // A Curve
        if (
            // lut.aCurves !== undefined && 
            lut.aCurves !== false && !this.isPassThrough(lut.aCurves)) {
            this.addStage(
                encoding.device,
                'stage_curves_v4',
                this.stage_curves_v4,
                lut.aCurves,
                encoding.device,
                '  [PCSv4_to_Device_via_V4LUT : aCurves : {name}]|({last}) > ({data}) ({data:f>16})'
            );
        }

        // switch to device encoding
        pcsInfo.pcsEncoding = encoding.device;
    };

    isIdentityMatrix(matrix) {
        return (matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 &&
            matrix[3] === 0 && matrix[4] === 1 && matrix[5] === 0 &&
            matrix[6] === 0 && matrix[7] === 0 && matrix[8] === 1 &&

            // Offsets
            matrix[9] === 0 && matrix[10] === 0 && matrix[11] === 0
        );
    }

    matrixHasOffsets(matrix) {
        return (matrix[9] !== 0 || matrix[10] !== 0 || matrix[11] !== 0);
    }

    createPipeline_PCS_to_Device_via_V2LUT(pcsInfo, inputProfile, outputProfile, intent) {


        // if Absolute Colorimetric then apply Adaptation
        this.createPipeline_Absolute_Adaptation_Output_Any_to_PCSv4(pcsInfo, outputProfile, intent);

        // ensure the PCS is the correct Format and correct Version
        var lut = outputProfile.B2A[this.intent2LUTIndex(intent)];
        this.pipelineConvert_PCSV4_to_OutputProfile_PCS(pcsInfo, lut, outputProfile);

        // PCS must be PCSXYZ or PCSv2
        if (!(pcsInfo.pcsEncoding === encoding.PCSv2 || pcsInfo.pcsEncoding === encoding.PCSXYZ)) {
            console.log(this.getStageNames(true));
            throw new Error('createPipeline_PCS_to_Device_via_V2LUT: expects PCSv2 or PCSXYZ not ' + encodingStr[pcsInfo.pcsEncoding]);
        }

        // V2 Profile pipeline
        this.addStage(
            pcsInfo.pcsEncoding,
            'stage_curve_v2',
            this.stage_curve_v2,
            lut.inputCurve,
            pcsInfo.pcsEncoding,
            '  [PCSv4_to_Device_via_V2LUT : {name}]| ({last})        > ({data})'
        );

        this.addStageLUT(
            true,
            pcsInfo.pcsEncoding,  // Going INTO to LUT its PCS encoding PCSXYZ or PCSv2 or PCSv4
            lut,
            encoding.device, // Now its device encoding
            '  [PCSv4_to_Device_via_V2LUT : {name}]|({last}) > ({data})'
        );

        pcsInfo.pcsEncoding = encoding.device;

        this.addStage(
            encoding.device,
            'stage_curve_v2',
            this.stage_curve_v2,
            lut.outputCurve,
            pcsInfo.pcsEncoding,
            '  [PCSv4_to_Device_via_V2LUT : {name}]|({last}) > ({data}) ({data:f>16})'
        );

    };

    createPipeline_PCS_to_Gray_via_kTRC(pcsInfo, inputProfile, outputProfile, intent) {
        if (!(pcsInfo.pcsEncoding === encoding.PCSv2 ||
            pcsInfo.pcsEncoding === encoding.PCSv4 ||
            pcsInfo.pcsEncoding === encoding.PCSXYZ)) {
            console.log(this.getStageNames(true));
            throw new Error('PCSv4_to_Gray: expects PCSv2,PCSv4,PCSXYZ encoding not ' + encodingStr[pcsInfo.pcsEncoding]);
        }

        // XYZ -> Gray or Lab -> Gray.
        // Since we only know the GrayTRC, we need to do some assumptions. Gray component will be
        // given by Y on XYZ PCS and by L* on Lab PCS, Both across inverse TRC curve.
        if (outputProfile.pcs === 'XYZ') {

            // Make sure we are in XYZ
            this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);

            // if Absolute Colorimetric then apply Adaptation
            // Since we are already in XYZ, it keeps this stage simple.
            if (intent === eIntent.absolute) {
                this.addStage(
                    encoding.PCSXYZ,
                    'stage_absoluteAdaptationOut_PCSXYZ_to_PCSXYZ',
                    this.stage_absoluteAdaptationOut_PCSXYZ_to_PCSXYZ,
                    outputProfile,
                    encoding.PCSXYZ,
                    '  [PCSv4_to_Gray : {name}]|({last}) > ({data})'
                );
            }

            this.addStage(
                encoding.PCSXYZ,
                'stage_PCSXYZ_to_grayTRC_via_Y',
                this.stage_PCSXYZ_to_grayTRC_via_Y,
                [outputProfile.Gray.inv_kTRC],
                encoding.device,
                '  [PCSv4_to_Gray : {name}]|({last}) > ({data}) ({data:f>16})'
            );

            pcsInfo.pcsEncoding = encoding.device;
        } else {

            // if Absolute Colorimetric then apply Adaptation
            this.createPipeline_Absolute_Adaptation_Output_Any_to_PCSv4(pcsInfo, outputProfile, intent);

            // PCSv2 and PCSv4 L is close enough not to warrant a conversion
            this.addStage(
                pcsInfo.pcsEncoding,
                'stage_PCSV4_to_grayTRC_via_L',
                this.stage_PCSV4_to_grayTRC_via_L,
                [outputProfile.Gray.inv_kTRC],
                encoding.device,
                '  [PCSv4_to_Gray : {name}]|({last}) > ({data}) ({data:f>16})'
            );

            pcsInfo.pcsEncoding = encoding.device;
        }
    };

    /**
     * Scales the PCS to adjust for the Absolute Intent white point
     * If the PCS is XYZ then we convert use the XYZ values to scale
     * If the PCS is Lab then we convert to XYZ and use the XYZ values to scale
     * Returns PCSv2 or PCSv4
     * @param pcsInfo
     * @param inputProfile
     * @param intent
     */
    createPipeline_Absolute_Adaptation_Input(pcsInfo, inputProfile, intent) {
        if (intent === eIntent.absolute) {

            // Convert to XYZ
            this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);

            if (this.pipelineDebug) {
                this.addStage(
                    encoding.PCSXYZ,
                    'Input_Absolute_Adaptation:',
                    this.stage_history,
                    '  [Input_Absolute_Adaptation] ..................................  ' +
                    'Xa = ' + inputProfile.absoluteAdaptationIn.Xa +
                    ', Ya = ' + inputProfile.absoluteAdaptationIn.Ya +
                    ', Za = ' + inputProfile.absoluteAdaptationIn.Za,
                    encoding.PCSXYZ,
                    ''
                );
            }

            this.usesAdaptation = true;


            // adaptation to Absolute Intent, cmsLab > XYZ > scale > XYZ > cmsLab
            this.addStage(
                encoding.PCSXYZ,
                'stage_absoluteAdaptationIn_PCSXYZ_to_PCSXYZ',
                this.stage_absoluteAdaptationIn_PCSXYZ_to_PCSXYZ,
                inputProfile,
                encoding.PCSXYZ,
                '  [InputAdaptation : {name}]| ({last}) > ({data})'
            );

            pcsInfo.pcsEncoding = encoding.PCSXYZ;
        }
    };


    /**
     * Scales the PCS to adjust for the Absolute Intent white point
     * If the PCS is XYZ then we convert use the XYZ values to scale
     * If the PCS is Lab then we convert to XYZ and use the XYZ values to scale
     * Returns PCSv2 or PCSv4
     * @param pcsInfo
     * @param outputProfile
     * @param intent
     */
    createPipeline_Absolute_Adaptation_Output_Any_to_PCSv4(pcsInfo, outputProfile, intent) {
        if (intent === eIntent.absolute) {

            if (!(pcsInfo.pcsEncoding === encoding.PCSv2 ||
                pcsInfo.pcsEncoding === encoding.PCSv4 ||
                pcsInfo.pcsEncoding === encoding.PCSXYZ
            )) {
                throw new Error('createPipeline_Absolute_Adaptation_Output_Any_to_PCSv4, Encoding must be PCSXYZ, PCSv2 or PVCSv4 not ' + encodingStr[pcsInfo.pcsEncoding]);
            }

            this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);

            if (this.pipelineDebug) {
                this.addStage(
                    encoding.PCSXYZ,
                    'Output_Absolute_Adaptation:',
                    this.stage_history,
                    +        '  [Output_Absolute_Adaptation] .................................  ' +
                    'Xa = ' + outputProfile.absoluteAdaptationOut.Xa +
                    ', Ya = ' + outputProfile.absoluteAdaptationOut.Ya +
                    ', Za = ' + outputProfile.absoluteAdaptationOut.Za,
                    encoding.PCSXYZ,
                    ''
                );
            }

            this.usesAdaptation = true;

            this.addStage(
                encoding.PCSXYZ,
                'stage_absoluteAdaptationOut_PCSXYZ_to_PCSXYZ',
                this.stage_absoluteAdaptationOut_PCSXYZ_to_PCSXYZ,
                outputProfile,
                encoding.PCSXYZ,
                '  [OutputAdaptation : {name}]| ({last}) > ({data})'
            );


            this.addStage(
                encoding.PCSXYZ,
                'stage_PCSXYZ_to_PCSv4',
                this.stage_PCSXYZ_to_PCSv4,
                null,
                encoding.PCSv4,
                '  [OutputAdaptation : {name}]| ({last}) > ({data})'
            );
            pcsInfo.pcsEncoding = encoding.PCSv4;


        }
    };


    /**
     * Converts from the PCS encoded to the destination PCS only if requured
     * @param pcsInfo
     * @param destinationPCS
     */
    pipeline_Convert_PCS_to(pcsInfo, destinationPCS) {
        var stage = this.createConvert_PCS_stage(pcsInfo, destinationPCS);
        if (stage) {
            this.pushStage(stage);
        }
    }
    createConvert_PCS_stage(pcsInfo, destinationPCS) {

        switch (destinationPCS) {
            case encoding.PCSXYZ:
                switch (pcsInfo.pcsEncoding) {

                    case encoding.PCSv2:
                        // Convert from V2 to XYZ
                        pcsInfo.pcsEncoding = encoding.PCSXYZ;
                        return this.createStage(
                            encoding.PCSv2,
                            'stage_PCSv2_to_PCSXYZ',
                            this.stage_PCSv2_to_PCSXYZ,
                            null,
                            encoding.PCSXYZ,
                            '  [Convert PCS : stage_PCSv2_to_PCSXYZ]  ({last}) > ({data})'
                        );

                    case encoding.PCSv4:
                        // Convert from V4 to XYZ
                        pcsInfo.pcsEncoding = encoding.PCSXYZ;
                        return this.createStage(
                            encoding.PCSv4,
                            'stage_PCSv4_to_PCSXYZ',
                            this.stage_PCSv4_to_PCSXYZ,
                            null,
                            encoding.PCSXYZ,
                            '  [Convert PCS : stage_PCSv4_to_PCSXYZ]  ({last}) > ({data})'
                        );

                    case encoding.PCSXYZ:
                        // No action required
                        return;

                    default:
                        throw new Error('pipelineConvert_PCSV4_to_OutputProfile_PCS, unexpected XYZ encoding ' + encodingStr[pcsInfo.pcsEncoding]);
                }


            case encoding.PCSv2:
                switch (pcsInfo.pcsEncoding) {
                    case encoding.PCSv2:
                        // No action required
                        return;

                    case encoding.PCSv4:
                        pcsInfo.pcsEncoding = encoding.PCSv2;
                        return this.createStage(
                            encoding.PCSv4,
                            'stage_PCSv4_to_PCSv2',
                            this.stage_PCSv4_to_PCSv2,
                            null,
                            pcsInfo.pcsEncoding,
                            '  [Convert PCS : {name}]  ({last}) > ({data})'
                        );

                    case encoding.PCSXYZ:
                        pcsInfo.pcsEncoding = encoding.PCSv2;
                        return this.createStage(
                            encoding.PCSXYZ,
                            'stage_PCSXYZ_to_PCSv2',
                            this.stage_PCSXYZ_to_PCSv2,
                            null,
                            encoding.PCSv2,
                            '  [Convert PCS : {name}]  ({last}) > ({data})'
                        );
                    default:
                        throw ('CheckPCSVersion, Unexpected LAB Encoding ' + encodingStr[pcsInfo.pcsEncoding]);
                }
            case encoding.PCSv4:
                switch (pcsInfo.pcsEncoding) {

                    case encoding.PCSXYZ:
                        pcsInfo.pcsEncoding = encoding.PCSv4;
                        return this.createStage(
                            encoding.PCSXYZ,
                            'stage_PCSXYZ_to_PCSv4',
                            this.stage_PCSXYZ_to_PCSv4,
                            null,
                            encoding.PCSv4,
                            '  [Convert PCS : {name}]  ({last}) > ({data})'
                        );

                    case encoding.PCSv2:
                        pcsInfo.pcsEncoding = encoding.PCSv4;
                        return this.createStage(
                            encoding.PCSv2,
                            'stage_PCSv2_to_PCSv4',
                            this.stage_PCSv2_to_PCSv4,
                            null,
                            encoding.PCSv4,
                            '  [Convert PCS : {name}]  ({last}) > ({data})'
                        );

                    case encoding.PCSv4:
                        // No action required
                        return;

                    default:
                        throw ('Convert PCS, Unexpected LAB Encoding ' + encodingStr[pcsInfo.pcsEncoding]);
                }
            default:
                throw new Error('pipelineConvert_PCS, unexpected destination PCS encoding ' + encodingStr[destinationPCS]);
        }

    }
    pipelineConvert_PCSV4_to_OutputProfile_PCS(pcsInfo, lut, profile) {
        let stage;
        switch (profile.pcs) {
            case 'XYZ':
                this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSXYZ);
                break;
            case 'LAB':
                switch (profile.version) {
                    case 2: // V2 PROFILE
                        if (lut.precision === 8) {
                            // 8Bit LUT with v2 encoding is the same as PCSv4 encoding,
                            // so this is a special case where ...
                            //
                            //  if XYZ - Convert to V4 and say its V2
                            //  if V2 - Convert to V4 and say its V2
                            //  if V4 - Encoding is correct, but need to add null stage to pass validation
                            //

                            stage = this.createConvert_PCS_stage(pcsInfo, encoding.PCSv4);
                            if (stage) {
                                // lie and say its V2
                                pcsInfo.pcsEncoding = encoding.PCSv2;
                                stage.outputEncoding = encoding.PCSv2;
                            } else {
                                // we have a problem, previous stage is PVSv4 and
                                // we will get a validation error as next stage
                                // is expecting PCSv2.
                                //
                                // So we need to add a stage that does nothing and
                                // says its PCSv2, the optimizer will delete this stage

                                // lie and say its V2
                                pcsInfo.pcsEncoding = encoding.PCSv2;

                                // Add null stage so validations pass
                                this.addStage(
                                    encoding.PCSv4,
                                    'stage_null',
                                    this.stage_null,
                                    null,
                                    pcsInfo.pcsEncoding,
                                    '  [CheckPCSVersion : {name}]  ({last}) > ({data})'
                                );
                            }
                        } else {
                            // 16 encoding LUT with v2 encoding
                            stage = this.createConvert_PCS_stage(pcsInfo, encoding.PCSv2);
                        }

                        if (stage) {
                            this.pushStage(stage);
                        }
                        break;
                    case 4: // v4 PROFILE
                        this.pipeline_Convert_PCS_to(pcsInfo, encoding.PCSv4);
                        break;
                    default:
                        throw new Error('pipelineConvert_PCSV4_to_OutputProfile_PCS, unexpected profile version ' + profile.version);
                }
        }
    }

    /**
     * Final step in the pipeline to convert from the Device encoded as cmsLab or PCSArray to the output format
     * @param pcsInfo
     * @param {Profile} outputProfile
     */

    createPipeline_Device_to_Output(pcsInfo, outputProfile) {

        var intSize;
        var intStageFn;
        var intStageDesc;
        if (this.dataFormat === 'int8' || this.dataFormat === 'int16') {
            switch (outputProfile.outputChannels) {
                case 1:
                    intStageFn = this.stage_device1_to_int;
                    intStageDesc = '[stage_device1_to_int ' + this.dataFormat + ' : {name}]| ({last}) > {data}';
                    break;
                case 2:
                    intStageFn = this.stage_device2_to_int;
                    intStageDesc = '[stage_device2_to_int ' + this.dataFormat + ' : {name}]| ({last}) > {data}';
                    break;
                case 3:
                    intStageFn = this.stage_device3_to_int;
                    intStageDesc = '[stage_device3_to_int ' + this.dataFormat + ' : {name}]| ({last}) > {data}';
                    break;
                case 4:
                    intStageFn = this.stage_device4_to_int;
                    intStageDesc = '[stage_device4_to_int ' + this.dataFormat + ' : {name}]| ({last}) > {data}';
                    break;
                default:
                    // generic
                    intStageFn = this.stage_deviceN_to_int;
                    intStageDesc = '[stage_deviceN_to_int ' + this.dataFormat + ' : {name}]| ({last}) > {data}';
            }
            intSize = this.dataFormat === 'int8' ? 255 : 65535;
        }

        switch (outputProfile.type) {
            case eProfileType.Gray:
                if (pcsInfo.pcsEncoding !== encoding.device) {
                    console.log(this.getStageNames(true));
                    throw new Error('[Device2Output: Gray ] Input must be Device not ' + encodingStr[pcsInfo.pcsEncoding]);
                }

                switch (this.dataFormat) {
                    case 'object':
                        this.addStage(
                            encoding.device,
                            this.roundOutput ? 'stage_device_to_Gray' : 'stage_device_to_Gray',
                            this.roundOutput ? this.stage_device_to_Gray_round : this.stage_device_to_Gray,
                            this.precision,
                            encoding.cmsRGB,
                            '  [Device2Output : Gray : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'objectFloat':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_Grayf',
                            this.stage_device_to_Grayf,
                            this.precision,
                            encoding.cmsRGB,
                            '  [Device2Output : Gray : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'int8':
                    case 'int16':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_int',
                            intStageFn,
                            intSize,
                            encoding.device,
                            intStageDesc
                        );
                        break;
                }
                break;

            case eProfileType.Duo:
                if (pcsInfo.pcsEncoding !== encoding.device) {
                    console.log(this.getStageNames(true));
                    throw new Error('[Device2Output: Duo ] Input must be Device not ' + encodingStr[pcsInfo.pcsEncoding]);
                }

                switch (this.dataFormat) {
                    case 'object':
                        this.addStage(
                            encoding.device,
                            this.roundOutput ? 'stage_device_to_Duo' : 'stage_device_to_Duo',
                            this.roundOutput ? this.stage_device_to_Duo_round : this.stage_device_to_Duo,
                            this.precision,
                            encoding.cmsRGB,
                            '  [Device2Output : Duo : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'objectFloat':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_Duof',
                            this.stage_device_to_Duof,
                            this.precision,
                            encoding.cmsRGB,
                            '  [Device2Output : Duo : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'int8':
                    case 'int16':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_int',
                            intStageFn,
                            intSize,
                            encoding.device,
                            intStageDesc
                        );
                        break;
                }
                break;

            case eProfileType.Lab:
                if (!(pcsInfo.pcsEncoding === encoding.PCSv2 || pcsInfo.pcsEncoding === encoding.PCSv4)) {
                    console.log(this.getStageNames(true));
                    throw new Error('[Device2Output: Lab ] Input must be PCS/V2 or PCS/V4 not ' + encodingStr[pcsInfo.pcsEncoding]);
                }
                switch (this.dataFormat) {
                    case 'object':
                    case 'objectFloat':
                        if (pcsInfo.pcsEncoding === encoding.PCSv2) {
                            this.addStage(
                                encoding.PCSv2,
                                'stage_PCSv2_to_cmsLab',
                                this.stage_PCSv2_to_cmsLab,
                                null,
                                encoding.cmsLab,
                                '  [Device2Output : Lab : {name}]|({last:r}) / ({last}) > {data}'
                            );
                        } else {
                            this.addStage(
                                encoding.PCSv4,
                                'stage_PCSv4_to_cmsLab',
                                this.stage_PCSv4_to_cmsLab,
                                null,
                                encoding.cmsLab,
                                '  [Device2Output : Lab : {name}]| ({last}) > {data}'
                            );
                        }
                        break;
                    case 'int8':
                    case 'int16':
                        //
                        // This will convert Lab/XYZ PCS to 8 or 16 bits
                        // That's a loss of precision, but need this for testing
                        //
                        this.addStage(
                            pcsInfo.pcsEncoding,
                            'stage_device_to_int',
                            intStageFn,
                            intSize,
                            encoding.device,
                            intStageDesc
                        );
                        break;
                }
                break;

            case eProfileType.RGBMatrix:
            case eProfileType.RGBLut:
                if (pcsInfo.pcsEncoding !== encoding.device) {
                    console.log(this.getStageNames(true));
                    throw new Error('[Device2Output: RGB ] Input must be Device not ' + encodingStr[pcsInfo.pcsEncoding]);
                }

                switch (this.dataFormat) {
                    case 'object':
                        this.addStage(
                            encoding.device,
                            this.roundOutput ? 'stage_device_to_RGB' : 'stage_device_to_RGB',
                            this.roundOutput ? this.stage_device_to_RGB_round : this.stage_device_to_RGB,
                            this.precision,
                            encoding.cmsRGB,
                            '  [Device2Output : RGB : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'objectFloat':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_RGBf',
                            this.stage_device_to_RGBf,
                            this.precision,
                            encoding.cmsRGB,
                            '  [Device2Output : RGB : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'int8':
                    case 'int16':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_int',
                            intStageFn,
                            intSize,
                            encoding.device,
                            intStageDesc
                        );
                        break;
                }
                break;

            case eProfileType.CMYK:
                if (pcsInfo.pcsEncoding !== encoding.device) {
                    console.log(this.getStageNames(true));
                    throw new Error('[Device2Output: CMYK ] Input must be Device not ' + encodingStr[pcsInfo.pcsEncoding]);
                }

                switch (this.dataFormat) {
                    case 'object':
                        this.addStage(
                            encoding.device,
                            this.roundOutput ? 'stage_device_to_CMYK' : 'stage_device_to_CMYK',
                            this.roundOutput ? this.stage_device_to_CMYK_round : this.stage_device_to_CMYK,
                            this.precision,
                            encoding.cmsCMYK,
                            '  [Device2Output : CMYK : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'objectFloat':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_CMYKf',
                            this.stage_device_to_CMYKf,
                            this.precision,
                            encoding.cmsCMYK,
                            '  [Device2Output : CMYK : {name}]| ({last}) > {data}'
                        );
                        break;
                    case 'int8':
                    case 'int16':
                        this.addStage(
                            encoding.device,
                            'stage_device_to_int',
                            intStageFn,
                            intSize,
                            encoding.device,
                            intStageDesc
                        );
                        break;
                }
                break;
        }
    }

    /**
     *
     * So, shocker, Javascript can be slow sometimes, so here rather than using a generic function to do the interpolation
     * we select a specific function for each type of interpolation. This is because the generic function are about 10-20x slower
     *
     * We optimize for the 3D to 3ch or 4ch which is RGB>RGB or RGB>CMYk and also 4D to 3ch or 4ch which is CMYk>RGB or CMYk>CMYk
     * Since Gray and Duo tone are not common we don't optimize for them
     *
     * Note, further down we also have optimized versions of the 3D and 4D interpolation functions for arrays, these are used
     * with prebuilt LUTS, however I noticed that if we used them here to save code, it would poison the JIT compiler and
     * make the array functions 2-3x slower as they were de-optimized, So keeping them separate means that the arrays
     * interpolation functions will be JIT optimized for clamped arrays and the pipeline functions below are optimized
     * for float arrays
     *
     */

    addStageLUT(useTrilinearFor3ChInput, inputEncoding, lut, outputEncoding, debugFormat) {
        switch (lut.inputChannels) {

            case 1:
                this.addStage(inputEncoding, 'linearInterp1D', this.linearInterp1D_NCh, lut, outputEncoding, debugFormat);
                break;

            case 2:
                this.addStage(inputEncoding, 'bilinearInterp2D', this.bilinearInterp2D_NCh, lut, outputEncoding, debugFormat);
                break;

            case 3:

                //https://littlecms2.blogspot.com/2010/
                // So, after investigation, I found the reason of those differences: Tetrahedral
                // interpolation being used in 2.0 and Trilinear interpolation in 1.19.
                // Tetrahedral was patented time ago, but now the patent has expired.
                // In fact, I did see such issue many years ago. On LUT elements being
                // indexed by Lab colorspace, Tetrahedral does not work well. I suspect
                // that's because Luma is uncentered (L is on one axis)
                // First thing to discard was a code bug. So I tried Max Derhak's SampleICC.
                // To my astonishment, SampleICC is also using trilinear by default.
                // Tried to modify Max code to do the interpolation as tetrahedral and...
                // bingo! the same "bad" results as Little CMS. Up to four decimals.
                // So here we go, the "bug" is in the interpolation algorithm
                // . I checked PhotoShop CS4. It seems to be also using trilinear as well.
                //
                // Upshot is that we should use trilinear for PCS LUT input, does not matter for output

                // Check for 3 channel input PCS and switch to trilinear
                const interpolation = (useTrilinearFor3ChInput && (inputEncoding === encoding.PCSv4 || inputEncoding === encoding.PCSv2)) ? 'trilinear' : this.interpolation3D;

                switch (interpolation) {
                    case 'tetrahedral':

                        if (this.interpolationFast) {
                            switch (lut.outputChannels) {
                                case 3:
                                    // optimized 3 channel output version
                                    // this.addStage(inputEncoding, 'tetrahedralInterp3D', this.tetrahedralInterp3D_3Ch, lut, outputEncoding, debugFormat);
                                    this.addStage(inputEncoding, 'tetrahedralInterp3D', tetrahedralInterp3D_3Ch, lut, outputEncoding, debugFormat);
                                    break;
                                case 4:
                                    // optimized 4 channel output version
                                    // this.addStage(inputEncoding, 'tetrahedralInterp3D', this.tetrahedralInterp3D_4Ch, lut, outputEncoding, debugFormat);
                                    this.addStage(inputEncoding, 'tetrahedralInterp3D', tetrahedralInterp3D_4Ch, lut, outputEncoding, debugFormat);
                                    break;
                                default:
                                    // Generic N channel output
                                    this.addStage(inputEncoding, 'tetrahedralInterp3D', tetrahedralInterp3D_NCh, lut, outputEncoding, debugFormat);
                                    break;
                            }
                            break;
                        } else {
                            // Use this to test the tetrahedralInterp3D function, this is the slowest method but we know its accurate
                            // this.addStage(inputEncoding, 'tetrahedralInterp3D', this.tetrahedralInterp3D_3or4Ch, lut, outputEncoding, debugFormat);
                            this.addStage(inputEncoding, 'tetrahedralInterp3D', tetrahedralInterp3D_3or4Ch, lut, outputEncoding, debugFormat);
                        }
                        break;

                    case 'trilinear':
                        switch (lut.outputChannels) {
                            // case 4:
                            //     this.addStage(inputEncoding, 'trilinearInterp3D', this.trilinearInterp3D_3or4Ch, lut, outputEncoding, debugFormat);
                            //     break;
                            default:
                                // this.addStage(inputEncoding, 'trilinearInterp3D', this.trilinearInterp3D_NCh, lut, outputEncoding, debugFormat);
                                this.addStage(inputEncoding, 'trilinearInterp3D', trilinearInterp3D_NCh, lut, outputEncoding, debugFormat);
                                // this.addStage(inputEncoding, 'tetrahedralInterp3D', tetrahedralInterp3D_4Ch, lut, outputEncoding, debugFormat);
                                break;

                        }
                        break;
                    default:
                        throw new Error('Unknown 3D interpolation method "' + interpolation + '"');
                }
                break;
            case 4:
                switch (this.interpolation4D) {
                    case 'tetrahedral':

                        if (this.interpolationFast) {
                            switch (lut.outputChannels) {
                                case 3:
                                    // optimized 3 channel output version
                                    this.addStage(inputEncoding, 'tetrahedralInterp4D', this.tetrahedralInterp4D_3Ch, lut, outputEncoding, debugFormat);
                                    break;
                                case 4:
                                    // optimized 4 channel output version
                                    this.addStage(inputEncoding, 'tetrahedralInterp4D', this.tetrahedralInterp4D_4Ch, lut, outputEncoding, debugFormat);
                                    break;
                                default:
                                    this.addStage(inputEncoding, 'tetrahedralInterp4D', this.tetrahedralInterp4D_NCh, lut, outputEncoding, debugFormat);
                            }
                        } else {
                            // Use this to test the tetrahedralInterp4D function, this is the slowest method but we know its accurate
                            this.addStage(inputEncoding, 'tetrahedralInterp4D', this.tetrahedralInterp4D_3or4Ch, lut, outputEncoding, debugFormat);
                        }
                        break;

                    case 'trilinear':
                        this.addStage(inputEncoding, 'trilinearInterp4D', this.trilinearInterp4D_3or4Ch, lut, outputEncoding, debugFormat);
                        break;

                    default:
                        throw new Error('Unknown 4D interpolation method "' + this.interpolation4D + '"');
                }
                break;
            default:
                throw new Error('Unsupported number of input channels "' + lut.inputChannels + '"');
        }
    };

    pushStage(stage) {
        this.pipeline.push(stage);
    };

    /**
     * Adds a transformation stage to the pipeline
     * 
     * This method creates and adds a stage to the transformation pipeline, similar to
     * Little-CMS's cmsPipelineInsertStage(). Each stage represents a single transformation
     * step in the color conversion process.
     * 
     * STAGE CONCEPT (Little-CMS parallel):
     * ===================================
     * A stage is analogous to Little-CMS's cmsStage structure. It encapsulates:
     * - Input/Output color space encodings
     * - Transform function that processes color data
     * - Stage-specific data and parameters
     * - Debug information for pipeline introspection
     * 
     * ENCODING TYPES:
     * ==============
     * - encoding.device: Native device values (0.0-1.0) - RGB, CMYK, etc.
     * - encoding.PCSXYZ: Profile Connection Space as XYZ values
     * - encoding.PCSv4: Profile Connection Space as Lab values (ICC v4)
     * - encoding.cmsLab: Lab color objects {L, a, b, whitePoint}
     * - encoding.cmsRGB: RGB color objects {R, G, B}
     * - encoding.cmsCMYK: CMYK color objects {C, M, Y, K}
     * 
     * PIPELINE EXECUTION:
     * ==================
     * During transformation, the pipeline processes each stage sequentially:
     * 1. Validates input encoding matches stage's expected input
     * 2. Calls the stage function with color data and stage-specific parameters
     * 3. Validates output encoding matches stage's declared output
     * 4. Passes result to next stage in pipeline
     * 
     * @param {encoding|false} inputEncoding - Expected input color space encoding, or false if no conversion
     * @param {string} stageName - Human-readable name for debugging (e.g., 'RGB_to_Lab', 'LUT_3D_interpolation')  
     * @param {Function} funct - Transform function: (colorData, stageData, stage) => transformedColorData
     * @param {*} stageData - Stage-specific data passed to transform function (matrices, LUTs, parameters, etc.)
     * @param {encoding|false} outputEncoding - Resulting output color space encoding, or false if no conversion
     * @param {string} [debugFormat=''] - Printf-style format string for debug output (e.g., '{name}: {data}')
     * @param {boolean} [optimized=false] - Whether this stage has been optimized (affects debugging)
     * @returns {void} Stage is added to this.pipeline array
     */
    addStage(inputEncoding, stageName, funct, stageData, outputEncoding, debugFormat, optimized) {
        this.pushStage(this.createStage(inputEncoding, stageName, funct, stageData, outputEncoding, debugFormat, optimized));
    };

    /**
     * Creates a stage object for the transformation pipeline
     * 
     * This factory method creates the fundamental building block of the color transformation
     * pipeline. Each stage object mirrors the structure of Little-CMS's cmsStage, containing
     * all information needed to execute a specific color transformation step.
     * 
     * STAGE STRUCTURE DETAILS:
     * =======================
     * The returned stage object contains these essential properties:
     * 
     * inputEncoding:  Color space format expected as input (e.g., encoding.device, encoding.PCSXYZ)
     * outputEncoding: Color space format produced as output
     * stageName:      Human-readable identifier for debugging and optimization
     * funct:          The actual transformation function that processes color data
     * stageData:      Transformation-specific data (matrices, LUTs, white points, etc.)
     * debugFormat:    Template string for debug output formatting
     * optimized:      Flag indicating whether this stage has been optimized
     * 
     * LITTLE-CMS COMPARISON:
     * =====================
     * Little-CMS cmsStage structure contains:
     * - Type (signature identifying the stage type)
     * - InputChannels/OutputChannels (number of color components)
     * - EvalPtr (function pointer for stage evaluation)
     * - Data (stage-specific parameters)
     * 
     * Our JavaScript equivalent provides similar functionality with more flexibility
     * for debugging and optimization in a dynamic language environment.
     * 
     * @param {encoding|false} inputEncoding - Input color space encoding
     * @param {string} stageName - Stage identifier for debugging and optimization
     * @param {Function} funct - Transform function (colorData, stageData, stage) => result
     * @param {*} stageData - Stage-specific transformation data
     * @param {encoding|false} outputEncoding - Output color space encoding
     * @param {string} [debugFormat=''] - Debug output formatting template
     * @param {boolean} [optimized=false] - Optimization status flag
     * @returns {_Stage} Complete stage object ready for pipeline insertion
     */
    createStage(inputEncoding, stageName, funct, stageData, outputEncoding, debugFormat, optimized) {
        debugFormat = debugFormat || '';

        return { inputEncoding, funct, stageData, outputEncoding, stageName, debugFormat, optimized };
    };

    stage_debug(data, label) {
        var lastData = null;
        this.addDebugHistory(label, 'stage_debug', lastData, data);
        return data;
    };

    addDebugHistory(label, stageName, lastData, data) {

        if (label.indexOf('{name}') >= 0) {
            label = label.replace('{name}', stageName);
        }

        var parts = label.split('{');

        for (var i = 1; i < parts.length; i++) {
            var temp = parts[i].split('}');
            var format = temp[0].split(':');

            switch (format[0].toLowerCase()) {
                case 'last':
                    temp[0] = data2String(lastData, format[1], this.debugHistoryDecimals);
                    break;
                case 'data':
                    temp[0] = data2String(data, format[1], this.debugHistoryDecimals);
                    break;
            }
            parts[i] = temp.join('');
        }
        this.debugHistory.push(parts.join(''));
    };

    stage_null(input) {
        return input;
    };

    stage_history(input, info) {

        // Add the info to the history
        this.debugHistory.push(info);

        return input;
    };



    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stages for Gray Data
    //

    /**
     * Converts device values to grayscale color representation.
     * 
     * @param {number[]} device
     */
    stage_device_to_Gray(device) {
        return {
            G: (device[0] * 255),
            type: eColourType.Gray
        };
    };

    /**
     * Converts device values to float grayscale color representation.
     * 
     * @param {number[]} device
     */
    stage_device_to_Grayf(device) {
        return {
            Gf: device[0],
            type: eColourType.Grayf
        };
    };

    /**
     * Converts device values to rounded grayscale color representation.
     * 
     * @param {number[]} device 
     * @param {number} precision
     */
    stage_device_to_Gray_round(device, precision) {
        return {
            G: roundN(device[0] * 255, precision),
            type: eColourType.Gray
        };
    };

    /**
     * Converts grayscale color to device values.
     * 
     * @param {import('./def.js')._cmsGray} cmsGray - Grayscale color object
     * @returns Device array with normalized grayscale value
     */
    stage_Gray_to_Device(cmsGray) {
        if (cmsGray.type === eColourType.Gray) {
            return [cmsGray.G / 255];
        }
        throw new Error('stage_Gray_to_Device: cmsInput expects _cmsGray');
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stages for Duotone (2 colour) Data
    //

    /**
     * Converts device values to duotone color representation.
     * 
     * @param {number[]} device
     */
    stage_device_to_Duo(device) {
        return {
            a: (device[0] * 100),
            b: (device[1] * 100),
            type: eColourType.Duo
        };
    };

    /**
     * Converts device values to float duotone color representation.
     * 
     * @param {number[]} device 
     */
    stage_device_to_Duof(device) {
        return {
            af: device[0],
            bf: device[1],
            type: eColourType.Duof
        };
    };

    /**
     * Converts device values to rounded duotone color representation.
     * 
     * @param {number[]} device 
     * @param {number} precision 
     */
    stage_device_to_Duo_round(device, precision) {
        return {
            a: roundN(device[0] * 100, precision),
            b: roundN(device[1] * 100, precision),
            type: eColourType.Duo
        };
    };

    /**
     * Converts duotone color to device values.
     * 
     * @param {import('./def.js')._cmsDuo | import('./def.js')._cmsDuof} cmsDuo - Duotone color object (integer or float)
     * @returns Device array with normalized duotone channel values
     */
    stage_Duo_to_Device(cmsDuo) {
        if (cmsDuo.type === eColourType.Duo) {
            const { a, b } = /** @type {import('./def.js')._cmsDuo} */ (cmsDuo);
            return [a / 100, b / 100];
        } else if (cmsDuo.type === eColourType.Duof) {
            const { af, bf } = /** @type {import('./def.js')._cmsDuof} */ (cmsDuo);
            return [af, bf];
        }
        throw new Error('stage_Duo_to_Device: cmsInput expects _cmsDuo');
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stages for RGB Data
    //

    /**
     * Converts device values to RGB color representation.
     * 
     * @param {number[]} device - Device color values (0.0 to 1.0)
     */
    stage_device_to_RGB(device) {
        return {
            R: (device[0] * 255),
            G: (device[1] * 255),
            B: (device[2] * 255),
            type: eColourType.RGB
        };
    };

    /**
     * Converts device values to rounded RGB color representation.
     * 
     * @param {number[]} device - Device color values (0.0 to 1.0)
     * @param {number} precision - Precision for rounding
     */
    stage_device_to_RGB_round(device, precision) {
        return {
            R: roundN(device[0] * 255, precision),
            G: roundN(device[1] * 255, precision),
            B: roundN(device[2] * 255, precision),
            type: eColourType.RGB
        };
    };

    /**
     * Converts device values to RGBf color representation.
     * 
     * @param {number[]} device - Device color values (0.0 to 1.0)
     */
    stage_device_to_RGBf(device) {
        return {
            Rf: device[0],
            Gf: device[1],
            Bf: device[2],
            type: eColourType.RGBf
        };
    };

    /**
     * Converts RGB color to device values
     * 
     * @param {import('./def.js')._cmsRGB | import('./def.js')._cmsRGBf} cmsRGB - RGB color object (8-bit or float)
     * @returns Device array with normalized RGB channel values
     */
    stage_RGB_to_Device(cmsRGB) {
        if (cmsRGB.type === eColourType.RGB) {
            const { R, G, B } = /** @type {import('./def.js')._cmsRGB} */ (cmsRGB);
            return [R / 255, G / 255, B / 255];
        }
        if (cmsRGB.type === eColourType.RGBf) {
            const { Rf, Gf, Bf } = /** @type {import('./def.js')._cmsRGBf} */ (cmsRGB);
            return [Rf, Gf, Bf];
        }
        throw new Error('InputtoPCS: cmsInput is not of type RGB or RGBf');
    };




    ////////////////////////////////////////////////////////////////////////////////
    //
    //   Stages for CMYK Data
    //

    /**
     * Converts device values to CMYKf color representation.
     * 
     * @param {number[]} device - Device color values (0.0 to 1.0)
     */
    stage_device_to_CMYKf(device) {
        return {
            Cf: device[0],
            Mf: device[1],
            Yf: device[2],
            Kf: device[3],
            type: eColourType.CMYKf
        };
    };

    /**
     * Converts device values to CMYK color representation.
     * 
     * @param {number[]} device - Device color values (0.0 to 1.0)
     */
    stage_device_to_CMYK(device) {
        return {
            C: (device[0] * 100),
            M: (device[1] * 100),
            Y: (device[2] * 100),
            K: (device[3] * 100),
            type: eColourType.CMYK
        };
    };

    /**
     * Converts device values to rounded CMYK color representation.
     * 
     * @param {number[]} device - Device color values (0.0 to 1.0)
     * @param {number} precision - Precision for rounding
     */
    stage_device_to_CMYK_round(device, precision) {
        return { //  * 0.0015259021896696422
            C: roundN(device[0] * 100, precision),
            M: roundN(device[1] * 100, precision),
            Y: roundN(device[2] * 100, precision),
            K: roundN(device[3] * 100, precision),
            type: eColourType.CMYK
        };
    };

    /**
     * Converts CMYK color to device values.
     * 
     * @param {import('./def.js')._cmsCMYK | import('./def.js')._cmsCMYKf} cmsCMYK - CMYK color object (percentage or float)
     * @returns Device array with normalized CMYK channel values
     */
    stage_CMYK_to_Device(cmsCMYK) {
        if (cmsCMYK.type === eColourType.CMYK) {
            const { C, M, Y, K } = /** @type {import('./def.js')._cmsCMYK} */ (cmsCMYK);
            return [C / 100, M / 100, Y / 100, K / 100];
        }
        if (cmsCMYK.type === eColourType.CMYKf) {
            const { Cf, Mf, Yf, Kf } = /** @type {import('./def.js')._cmsCMYKf} */ (cmsCMYK);
            return [Cf, Mf, Yf, Kf];
        }
        throw new Error('stage_CMYK_to_Device: cmsInput expects _cmsCMYK or _cmsCMYKf ');
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //
    //                     Stages for  Int Data
    //
    //

    stage_device1_to_int(device, intSize) {
        return [
            Math.round(device[0] * intSize)
        ];
    };

    stage_device2_to_int(device, intSize) {
        return [
            Math.round(device[0] * intSize),
            Math.round(device[1] * intSize),
        ];
    };


    stage_device3_to_int(device, intSize) {
        return [
            Math.round(device[0] * intSize),
            Math.round(device[1] * intSize),
            Math.round(device[2] * intSize)
        ];
    };

    stage_device4_to_int(device, intSize) {
        return [
            Math.round(device[0] * intSize),
            Math.round(device[1] * intSize),
            Math.round(device[2] * intSize),
            Math.round(device[3] * intSize),
        ];
    };


    /**
     *
     * @param {array} device
     * @param {number} intSize  255 || 65535
     */
    stage_deviceN_to_int(device, intSize) {

        //todo - Impliment a dithering method for 8bit output
        var output = new Array(device.length);
        for (var i = 0; i < device.length; i++) {
            output[i] = Math.round(device[i] * intSize);
        }
        return output;
    };

    stage_Int_to_Device(data, intScale) {
        if (data.length === 3) {
            return [
                data[0] / intScale,
                data[1] / intScale,
                data[2] / intScale
            ];
        }
        return [
            data[0] / intScale,
            data[1] / intScale,
            data[2] / intScale,
            data[3] / intScale
        ];
    };

    /**
     * Convert int16 Lab array to Lab color object
     * Uses Lab V4 encoding: L: 0-65535 → 0-100, a/b: 0-65535 → -128 to +127 (32896 is zero)
     * @param {number[]|Uint16Array} data - Lab16 encoded array [L, a, b]
     * @returns {import('./def.js')._cmsLabD50} Lab color object
     */
    stage_Int16_to_Lab(data) {
        return {
            type: eColourType.Lab,
            L: data[0] / 655.35,              // L: 0-65535 → 0-100
            a: (data[1] / 257.0) - 128.0,     // a: 0-65535 → -128 to +127
            b: (data[2] / 257.0) - 128.0,     // b: 0-65535 → -128 to +127
            whitePoint: convert.d50
        };
    };

    /**
     * Convert int8 Lab array to Lab color object
     * Uses Lab8 encoding: L: 0-255 → 0-100, a/b: 0-255 → -128 to +127 (128 is zero)
     * @param {number[]|Uint8Array} data - Lab8 encoded array [L, a, b]
     * @returns {import('./def.js')._cmsLabD50} Lab color object
     */
    stage_Int8_to_Lab(data) {
        return {
            type: eColourType.Lab,
            L: (data[0] / 255.0) * 100.0,     // L: 0-255 → 0-100
            a: data[1] - 128.0,                // a: 0-255 → -128 to +127
            b: data[2] - 128.0,                // b: 0-255 → -128 to +127
            whitePoint: convert.d50
        };
    };

    XYZ(X, Y, Z) {
        return {
            type: eColourType.XYZ,
            X: X,
            Y: Y,
            Z: Z,
        };
    };


    Lab(L, a, b, whitePoint) {
        return {
            type: eColourType.Lab,
            L: L,
            a: a,
            b: b,
            whitePoint: whitePoint || illuminants.d50
        };
    }

    XYZ2Lab(XYZ, whitePoint) {
        var limit = (24.0 / 116.0) * (24.0 / 116.0) * (24.0 / 116.0);
        whitePoint = whitePoint || illuminants.d50;

        var fx = (XYZ.X / whitePoint.X);
        var fy = (XYZ.Y / whitePoint.Y);
        var fz = (XYZ.Z / whitePoint.Z);

        fx = (fx <= limit) ? ((841.0 / 108.0) * fx) + (16.0 / 116.0) : Math.pow(fx, 1.0 / 3.0);
        fy = (fy <= limit) ? ((841.0 / 108.0) * fy) + (16.0 / 116.0) : Math.pow(fy, 1.0 / 3.0);
        fz = (fz <= limit) ? ((841.0 / 108.0) * fz) + (16.0 / 116.0) : Math.pow(fz, 1.0 / 3.0);

        return {
            L: 116.0 * fy - 16.0,
            a: 500.0 * (fx - fy),
            b: 200.0 * (fy - fz),
            whitePoint: whitePoint,
            type: eColourType.Lab
        };

    }

    Lab2XYZ(Lab, whitePoint) {
        whitePoint = whitePoint || Lab.whitePoint || illuminants.d50;
        var limit = (24.0 / 116.0);

        var y = (Lab.L + 16.0) / 116.0;
        var x = y + 0.002 * Lab.a;
        var z = y - 0.005 * Lab.b;

        return {
            X: (x <= limit ? (108.0 / 841.0) * (x - (16.0 / 116.0)) : x * x * x) * whitePoint.X,
            Y: (y <= limit ? (108.0 / 841.0) * (y - (16.0 / 116.0)) : y * y * y) * whitePoint.Y,
            Z: (z <= limit ? (108.0 / 841.0) * (z - (16.0 / 116.0)) : z * z * z) * whitePoint.Z,
            type: eColourType.XYZ
        };
    }

    Lab2PCSv4(labD50) {
        return [
            labD50.L / 100,
            (labD50.a + 128) / 255,
            (labD50.b + 128) / 255
        ];
    };


    Lab2PCSv2(labD50) {
        return [
            labD50.L * 652.80 / 65535.0,
            (labD50.a + 128) * 256 / 65535.0,
            (labD50.b + 128) * 256 / 65535.0
        ];
    };

    /**
     * Converts RGB device values to either PCS v4 or Lab D50 representation.
     * 
     * @param {number[]} device - The RGB device values.
     * @param {Profile} RGBProfile - The RGB profile information.
     * @param {boolean} [asLab] - Whether to return the result as Lab D50.
     * @param {boolean} [adaptation] - Whether to apply chromatic adaptation.
     * @returns The converted color representation.
     */
    RGBDevice_to_PCSv4_or_LabD50(device, RGBProfile, asLab, adaptation) {
        // Gamma correction
        let R, G, B, d, d0, d1, d2;

        /** @type {import('./convert.js').Matrix3x3=} */
        let matrix;

        if (RGBProfile.rgb.rTRC && RGBProfile.rgb.rTRC.use) {
            d = this.stage_curves_v4(device, [RGBProfile.rgb.rTRC, RGBProfile.rgb.rTRC, RGBProfile.rgb.rTRC]);
            d0 = d[0];
            d1 = d[1];
            d2 = d[2];
        } else {
            d0 = Math.min(Math.max(device[0], 0.0), 1.0);
            d1 = Math.min(Math.max(device[1], 0.0), 1.0);
            d2 = Math.min(Math.max(device[2], 0.0), 1.0);
        }

        if (RGBProfile.RGBMatrix.issRGB) {
            R = convert.sRGBGamma(d0);
            G = convert.sRGBGamma(d1);
            B = convert.sRGBGamma(d2);
        } else {
            var gamma = 1 / (RGBProfile.RGBMatrix?.gamma ?? NaN);
            R = Math.pow(d0, gamma);
            G = Math.pow(d1, gamma);
            B = Math.pow(d2, gamma);
        }

        if (adaptation) {
            // whitespace adaptaton
            matrix = RGBProfile.RGBMatrix?.matrixV4;
        } else {
            matrix = RGBProfile.RGBMatrix?.XYZMatrix;
        }

        if (!matrix) throw new Error("Missing RGB matrix");

        let XYZ = {
            X: R * matrix.m00 + G * matrix.m01 + B * matrix.m02,
            Y: R * matrix.m10 + G * matrix.m11 + B * matrix.m12,
            Z: R * matrix.m20 + G * matrix.m21 + B * matrix.m22
        };

        if (adaptation) {
            if (!RGBProfile.mediaWhitePoint) throw new Error("Missing media white point");

            // XYZ are now set, but may need chromatic adaptation
            const destWhitePoint = convert.d50;
            // if (!this.compareWhitePoints(destWhitePoint, RGBProfile.mediaWhitePoint)) {
            if (!convert.compareWhitePoints(destWhitePoint, RGBProfile.mediaWhitePoint)) {
                XYZ = convert.adaptation(XYZ, RGBProfile.mediaWhitePoint, destWhitePoint);
            }
        }

        if (asLab) {
            return this.XYZ2Lab(XYZ, illuminants.d50);
        }

        const lab = this.XYZ2Lab(XYZ, illuminants.d50);

        return [
            lab.L / 100,
            (lab.a + 128) / 255,
            (lab.b + 128) / 255
        ];
    }

    PCSv4_to_RGBDevice(PCSv4, RGBProfile, adaptation) {

        var XYZ = this.Lab2XYZ({
            L: PCSv4[0] * 100,
            a: ((PCSv4[1] * 255) - 128.0),
            b: ((PCSv4[2] * 255) - 128.0),
        }, illuminants.d50);
        var R, G, B, matrixInv;

        if (adaptation) {
            var whitePoint = illuminants.d50;
            // whitespace adaptaton, Note that there is a tolerance
            if (!convert.compareWhitePoints(whitePoint, RGBProfile.mediaWhitePoint)) {
                XYZ = convert.adaptation(XYZ, whitePoint, RGBProfile.mediaWhitePoint);
            }

            // XYZ to RGB
            matrixInv = RGBProfile.RGBMatrix.matrixInv;
        } else {
            matrixInv = RGBProfile.RGBMatrix.XYZMatrixInv;
        }

        R = XYZ.X * matrixInv.m00 + XYZ.Y * matrixInv.m01 + XYZ.Z * matrixInv.m02;
        G = XYZ.X * matrixInv.m10 + XYZ.Y * matrixInv.m11 + XYZ.Z * matrixInv.m12;
        B = XYZ.X * matrixInv.m20 + XYZ.Y * matrixInv.m21 + XYZ.Z * matrixInv.m22;

        if (RGBProfile.rgb.rTRCInv && RGBProfile.rgb.rTRCInv.use) {
            return this.stage_curves_v4([R, G, B], [RGBProfile.rgb.rTRCInv, RGBProfile.rgb.rTRCInv, RGBProfile.rgb.rTRCInv]);
        }

        R = Math.min(Math.max(R, 0.0), 1.0);
        G = Math.min(Math.max(G, 0.0), 1.0);
        B = Math.min(Math.max(B, 0.0), 1.0);

        if (RGBProfile.RGBMatrix.issRGB) {
            return [
                convert.sRGBGammaInv(R),
                convert.sRGBGammaInv(G),
                convert.sRGBGammaInv(B)
            ];
        } else {
            return [
                Math.pow(R, RGBProfile.RGBMatrix.gamma),
                Math.pow(G, RGBProfile.RGBMatrix.gamma),
                Math.pow(B, RGBProfile.RGBMatrix.gamma)
            ];
        }
    };

    /**
     * Transforms RGB device values to RGB device values using lookup table
     * Note - Due to the way LittleCMS rounds numbers internally some of the values
     * are not exactly the same as the values output by LittleCMS
     * @param device - Input RGB device values array
     * @param data - Lookup table data for transformation
     * @returns Array of transformed RGB device values
     * @constructor
     */
    RGBDevice_to_RGBDevice(device, data) {

        var Ro, Go, Bo, matrix, igamma;
        var Ri, Gi, Bi;

        if (data.input.curvesInv) {
            var d = this.stage_curves_v4(device, data.output.curvesInv);
            Ri = d[0];
            Gi = d[1];
            Bi = d[2];
        } else {
            if (data.input.issRGB) {
                Ri = convert.sRGBGammaInv(device[0]);
                Gi = convert.sRGBGammaInv(device[1]);
                Bi = convert.sRGBGammaInv(device[2]);
            } else {
                igamma = data.input.gamma;
                Ri = Math.pow(device[0], igamma);
                Gi = Math.pow(device[1], igamma);
                Bi = Math.pow(device[2], igamma);
            }
        }

        matrix = data.matrix;
        Ro = Ri * matrix.m00 + Gi * matrix.m01 + Bi * matrix.m02;
        Go = Ri * matrix.m10 + Gi * matrix.m11 + Bi * matrix.m12;
        Bo = Ri * matrix.m20 + Gi * matrix.m21 + Bi * matrix.m22;

        // Some clipping
        Ro = Math.min(Math.max(Ro, 0.0), 1.0);
        Go = Math.min(Math.max(Go, 0.0), 1.0);
        Bo = Math.min(Math.max(Bo, 0.0), 1.0);

        // Gamma
        if (data.output.curves) {
            return this.stage_curves_v4([Ro, Go, Bo], data.output.curves);
        }

        if (data.output.issRGB) {
            return [
                convert.sRGBGamma(Ro),
                convert.sRGBGamma(Go),
                convert.sRGBGamma(Bo)
            ];
        }
        return [
            Math.pow(Ro, 1 / data.output.gamma),
            Math.pow(Go, 1 / data.output.gamma),
            Math.pow(Bo, 1 / data.output.gamma)
        ];
    }

    stage_Gamma(device, data) {
        var i0 = Math.min(Math.max(device[0], 0.0), 1.0);
        var i1 = Math.min(Math.max(device[1], 0.0), 1.0);
        var i2 = Math.min(Math.max(device[2], 0.0), 1.0);

        if (data.issRGB) {
            return [
                convert.sRGBGamma(i0),
                convert.sRGBGamma(i1),
                convert.sRGBGamma(i2)
            ];
        }
        return [
            Math.pow(i0, 1 / data.gamma),
            Math.pow(i1, 1 / data.gamma),
            Math.pow(i2, 1 / data.gamma)
        ];
    }

    stage_Gamma_Inverse(device, data) {
        var i0 = Math.min(Math.max(device[0], 0.0), 1.0);
        var i1 = Math.min(Math.max(device[1], 0.0), 1.0);
        var i2 = Math.min(Math.max(device[2], 0.0), 1.0);

        if (data.issRGB) {
            return [
                convert.sRGBGammaInv(i0),
                convert.sRGBGammaInv(i1),
                convert.sRGBGammaInv(i2)
            ];
        }

        return [
            Math.pow(i0, data.gamma),
            Math.pow(i1, data.gamma),
            Math.pow(i2, data.gamma)
        ];
    }
    //m[row][column]
    //  00   01    02
    //  10   11    12
    //  20   21    22
    stage_matrix_rgb(device, matrix) {
        var i0, i1, i2;
        var o0, o1, o2;
        i0 = device[0];
        i1 = device[1];
        i2 = device[2];

        o0 = i0 * matrix.m00 + i1 * matrix.m01 + i2 * matrix.m02;
        o1 = i0 * matrix.m10 + i1 * matrix.m11 + i2 * matrix.m12;
        o2 = i0 * matrix.m20 + i1 * matrix.m21 + i2 * matrix.m22;

        return [o0, o1, o2];
    }

    stage_chromaticAdaptation(PCSXYZ, data) {
        var XYZ = this.XYZ(
            PCSXYZ[0] * u1Fixed15NumberMax,
            PCSXYZ[1] * u1Fixed15NumberMax,
            PCSXYZ[2] * u1Fixed15NumberMax
        );

        XYZ = convert.adaptation(XYZ, data.inWhitePoint, data.outWhitePoint);

        return [
            XYZ.X / u1Fixed15NumberMax,
            XYZ.Y / u1Fixed15NumberMax,
            XYZ.Z / u1Fixed15NumberMax
        ];
    }

    ////////////////////////////////////////////////////////////////////////////////
    //
    //
    //                   Stages for Absolute Adaptation
    //
    //

    stage_absoluteAdaptationIn_PCSXYZ_to_PCSXYZ(pcsXYZ, profile) {
        return [
            pcsXYZ[0] *= profile.absoluteAdaptationIn.Xa,
            pcsXYZ[1] *= profile.absoluteAdaptationIn.Ya,
            pcsXYZ[2] *= profile.absoluteAdaptationIn.Za
        ];
    };

    stage_absoluteAdaptationOut_PCSXYZ_to_PCSXYZ(pcsXYZ, profile) {
        return [
            pcsXYZ[0] *= profile.absoluteAdaptationOut.Xa,
            pcsXYZ[1] *= profile.absoluteAdaptationOut.Ya,
            pcsXYZ[2] *= profile.absoluteAdaptationOut.Za
        ];
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stage for Black Point Compensation
    //

    stage_ApplyBPCScale_PCSXYZ_to_PCSXYZ(PCSXYZ, BPC) {
        return [
            ((BPC.scale.X * (PCSXYZ[0] * u1Fixed15NumberMax)) + BPC.offset.X) / u1Fixed15NumberMax,
            ((BPC.scale.Y * (PCSXYZ[1] * u1Fixed15NumberMax)) + BPC.offset.Y) / u1Fixed15NumberMax,
            ((BPC.scale.Z * (PCSXYZ[2] * u1Fixed15NumberMax)) + BPC.offset.Z) / u1Fixed15NumberMax
        ];
    };


    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stages for converting Mono to PCS without a lut
    //

    stage_grayTRC_to_PCSXYZ_Via_Y(input, curves) {
        var n = this.stage_curves_v4([input[0]], curves)[0];

        return [
            illuminants.d50.X * n / u1Fixed15NumberMax,
            illuminants.d50.Y * n / u1Fixed15NumberMax,
            illuminants.d50.Z * n / u1Fixed15NumberMax,
        ];
    };

    stage_grayTRC_to_PCSV4_Via_L(input, curves) {
        return [
            this.stage_curves_v4([input[0]], curves)[0],
            0.5,
            0.5
        ];
    };

    stage_PCSXYZ_to_grayTRC_via_Y(pcsXYZ, invCurves) {
        var X = pcsXYZ[1] * u1Fixed15NumberMax; // grab the XYZ Y value
        return [
            this.stage_curves_v4([X], invCurves)[0],
        ];
    };

    stage_PCSV4_to_grayTRC_via_L(pcslab, invCurves) {
        var L = pcslab[0];
        return [
            this.stage_curves_v4([L], invCurves)[0],
        ];
    };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stage for Convert between PCS
    //

    stage_PCSv4_to_PCSv2(pcsLab) {
        // 0x8000 / 0x8080
        // 65280.0/65535
        return [
            pcsLab[0] * 0.9961089494163424,
            pcsLab[1] * 0.9961089494163424,
            pcsLab[2] * 0.9961089494163424
        ];
    };

    /**
     * Converts Profile Connection Space v2 Lab values to PCS v4 Lab values
     * @param pcsLab - PCS v2 Lab color values array
     * @returns Array of PCS v4 Lab color values
     */
    stage_PCSv2_to_PCSv4(pcsLab) {
        // 0x8080 / 0x8000
        // 65535.0/65280.0 = 1.00390625
        return [
            pcsLab[0] * 1.00390625,
            pcsLab[1] * 1.00390625,
            pcsLab[2] * 1.00390625
        ];
    };

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Convert from PCS > X

    // TODO - check optimisation can use this
    stage_LabD50_to_PCSXYZ(labD50) {
        var XYZ = this.Lab2XYZ(labD50);

        return [
            XYZ.X / u1Fixed15NumberMax,
            XYZ.Y / u1Fixed15NumberMax,
            XYZ.Z / u1Fixed15NumberMax
        ];
    };

    stage_XYZ_to_PCSXYZ(XYZ) {
        return [
            XYZ.X / u1Fixed15NumberMax,
            XYZ.Y / u1Fixed15NumberMax,
            XYZ.Z / u1Fixed15NumberMax
        ];
    };

    /**
     * Converts Profile Connection Space v2 Lab to PCS XYZ values
     * @param {import('./def.js')._PCS} PCSv2 - PCS v2 Lab color values array
     * @returns PCS XYZ color values array
     */
    stage_PCSv2_to_PCSXYZ(PCSv2) {
        var XYZ = this.Lab2XYZ(this.Lab(
            PCSv2[0] * 100.390625, // L
            ((PCSv2[1] * 255.99609375) - 128.0), // a
            ((PCSv2[2] * 255.99609375) - 128.0),  // b
            illuminants.d50
        ));

        return [
            XYZ.X / u1Fixed15NumberMax,
            XYZ.Y / u1Fixed15NumberMax,
            XYZ.Z / u1Fixed15NumberMax
        ];
    };

    /**
     * Converts Profile Connection Space v4 Lab to PCS XYZ values
     * @param {import('./def.js')._PCS} PCSv4 - PCS v4 Lab color values array
     * @returns PCS XYZ color values array
     */
    stage_PCSv4_to_PCSXYZ(PCSv4) {
        var XYZ = this.Lab2XYZ(this.Lab(
            PCSv4[0] * 100, // L
            ((PCSv4[1] * 255) - 128.0), // a
            ((PCSv4[2] * 255) - 128.0), // b
            illuminants.d50
        ));
        return [
            XYZ.X / u1Fixed15NumberMax,
            XYZ.Y / u1Fixed15NumberMax,
            XYZ.Z / u1Fixed15NumberMax
        ];
    };

    /**
     * Converts PCS XYZ values to Profile Connection Space v4 format
     * @param {import('./def.js')._cmsXYZ} PCSXYZ - PCS XYZ color values array
     * @returns PCS v4 format array with normalized values
     */
    stage_PCSXYZ_to_PCSv4(PCSXYZ) {
        var XYZ = this.XYZ(
            PCSXYZ[0] * u1Fixed15NumberMax,
            PCSXYZ[1] * u1Fixed15NumberMax,
            PCSXYZ[2] * u1Fixed15NumberMax
        );
        var lab = this.XYZ2Lab(XYZ, illuminants.d50);
        return [
            lab.L / 100,
            (lab.a + 128) / 255,
            (lab.b + 128) / 255
        ];
    };

    stage_PCSXYZ_to_LabD50(PCSXYZ) {
        var XYZ = this.XYZ(
            PCSXYZ[0] * u1Fixed15NumberMax,
            PCSXYZ[1] * u1Fixed15NumberMax,
            PCSXYZ[2] * u1Fixed15NumberMax
        );
        return this.XYZ2Lab(XYZ, illuminants.d50);
    };

    /**
     *
     * @param {import('./def.js')._cmsXYZ} PCSXYZ
     */
    stage_PCSXYZ_to_PCSv2(PCSXYZ) {
        var XYZ = this.XYZ(
            PCSXYZ[0] * u1Fixed15NumberMax,
            PCSXYZ[1] * u1Fixed15NumberMax,
            PCSXYZ[2] * u1Fixed15NumberMax,
        );
        var lab = this.XYZ2Lab(XYZ, illuminants.d50);
        return [
            lab.L * 652.80 / 65535.0,
            (lab.a + 128) * 256 / 65535.0,
            (lab.b + 128) * 256 / 65535.0
        ];
    };
    /**
     * Converts Profile Connection Space v2 values to CIE Lab D50 format
     * @param {import('./def.js')._PCS} PCSv2 - PCS v2 color values array
     * @returns Lab D50 color object with lightness and chromaticity values
     */
    stage_PCSv2_to_LabD50(PCSv2) {
        return {
            // L:  PCSv2[0] * 65535 / 652.80,
            // a: ((PCSv2[1] * 65535 / 256.0) - 128.0),
            // b: ((PCSv2[2] * 65535 / 256.0) - 128.0)
            L: PCSv2[0] * 100.390625,
            a: ((PCSv2[1] * 255.99609375) - 128.0),
            b: ((PCSv2[2] * 255.99609375) - 128.0)
        };
    };

    /**
     * Converts Profile Connection Space v2 values to CIE Lab format
     * @param {import('./def.js')._PCS} PCSv2 - PCS v2 color values array
     * @returns Lab color object with lightness and chromaticity values
     */
    stage_PCSv2_to_cmsLab(PCSv2) {
        return {
            L: PCSv2[0] * 100.390625,
            a: ((PCSv2[1] * 255.99609375) - 128.0),
            b: ((PCSv2[2] * 255.99609375) - 128.0),
            type: eColourType.Lab,
            whitePoint: illuminants.d50
        };
    };

    stage_PCSv4_to_LabD50(PCSv4) {
        return {
            L: PCSv4[0] * 100,
            a: ((PCSv4[1] * 255) - 128.0),
            b: ((PCSv4[2] * 255) - 128.0)
        };
    };

    /**
     * @param {import('./def.js')._PCS } PCSv4
     */
    stage_PCSv4_to_cmsLab(PCSv4) {
        return {
            //L:   PCSv4[0] * 65535 / 655.35,
            //a: ((PCSv4[1] * 65535 / 257.0) - 128.0),
            //b: ((PCSv4[2] * 65535 / 257.0) - 128.0),
            L: PCSv4[0] * 100,
            a: ((PCSv4[1] * 255) - 128.0),
            b: ((PCSv4[2] * 255) - 128.0),
            type: eColourType.Lab,
            whitePoint: illuminants.d50
        };
    };






    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Convert from cmsLab

    /**
     *
     * @param {import('./def.js')._cmsLab} cmsLab
     */
    stage_cmsLab_to_LabD50(cmsLab) {
        if (cmsLab.type === eColourType.Lab) {
            return convert.Lab2LabD50(cmsLab);
        }
        throw new Error('stage_cmsLab_to_LabD50: input is not of type Lab');
    };


    /**
     *
     * @param {Profile} profile
     * @param {import('./def.js')._cmsLabD50} LabD50
     * @returns {import('./def.js')._Device}
     */
    stage_PCSv4_to_RGBDevice(LabD50, profile) {
        return this.PCSv4_to_RGBDevice(LabD50, profile, this._RGBMatrixWhiteAdadaptation);
    };

    /**
     * Converts RGB device values to Profile Connection Space v4 format
     * @param device - RGB device values array
     * @param {Profile} profile - RGB profile with transformation matrix
     * @returns PCS v4 format color values
     */
    stage_RGBDevice_to_PCSv4(device, profile) {
        return this.RGBDevice_to_PCSv4_or_LabD50(device, profile, false, this._RGBMatrixWhiteAdadaptation);
    };


    /**
     * Converts CIE Lab D50 values to Profile Connection Space v4 format
     * @param {import('./def.js')._cmsLab} labD50 - Lab D50 color object
     * @returns PCS v4 format array with normalized Lab values
     */
    stage_LabD50_to_PCSv4(labD50) {
        return [
            labD50.L / 100,
            (labD50.a + 128) / 255,
            (labD50.b + 128) / 255
        ];
    };


    /** @param {import('./def.js')._cmsLabD50} labD50 */
    stage_LabD50_to_PCSv2(labD50) {
        return [
            labD50.L * 652.80 / 65535.0,
            (labD50.a + 128) * 256 / 65535.0,
            (labD50.b + 128) * 256 / 65535.0
        ];
    };

    /** @param {import('./def.js')._cmsLabD50} labD50 */
    stage_LabD50_to_cmsLab(labD50) {
        return {
            L: labD50.L,
            a: labD50.a,
            b: labD50.b,
            type: eColourType.Lab,
            whitePoint: illuminants.d50
        };
    };


    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stage for 3 X 3 matrix operations with helper functions
    //

    /**
     * Applies a 3x3 matrix transformation to a 3D vector with offsets.
     *
     * @param {number[]} matrix
     * @param {number[]} input
     *
     *   [ 0 1 2 ] + [ 9  ]
     *   [ 3 4 5 ] + [ 10 ]
     *   [ 6 7 8 ] + [ 11 ]
     */
    stage_matrix_v4(input, matrix) {
        //note that the b-curves will clip
        return [
            (matrix[0] * input[0]) + (matrix[1] * input[1]) + (matrix[2] * input[2]) + matrix[9],
            (matrix[3] * input[0]) + (matrix[4] * input[1]) + (matrix[5] * input[2]) + matrix[10],
            (matrix[6] * input[0]) + (matrix[7] * input[1]) + (matrix[8] * input[2]) + matrix[11]
        ];
    };

    /**
     * Applies a 3x3 matrix transformation to a 3D vector without offsets.
     * 
     * @param {number[]} input
     * @param {number[]} matrix
     */
    stage_matrix_v4_noOffsets(input, matrix) {
        //note that the b-curves will clip
        return [
            (matrix[0] * input[0]) + (matrix[1] * input[1]) + (matrix[2] * input[2]),
            (matrix[3] * input[0]) + (matrix[4] * input[1]) + (matrix[5] * input[2]),
            (matrix[6] * input[0]) + (matrix[7] * input[1]) + (matrix[8] * input[2])
        ];
    };
    /**
     * Applies a 3x3 matrix transformation to a 3D vector.
     *
     * @param {number[]} vector array of 3 points
     * @param {number[]} matrix array of 9 points
     * 
     *   [ 0 1 2 ]
     *   [ 3 4 5 ]
     *   [ 6 7 8 ]
     */
    evalMatrix(vector, matrix) {
        return [
            matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
            matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
            matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2]
        ];
    };

    /**
     * Inverts a 3x3 matrix.
     * 
     * @param {number[]} m matrix array of 12 points
     *       0 1 2
     *  0  [ 0 1 2 ]
     *  1  [ 3 4 5 ]
     *  2  [ 6 7 8 ]
     */
    invertMatrix(m) {

        const determinant =
            m[0] * (m[8] * m[4] - m[7] * m[5]) -
            m[3] * (m[8] * m[1] - m[7] * m[2]) +
            m[6] * (m[5] * m[1] - m[4] * m[2]);

        const scale = 1.0 / determinant;

        return [
            scale * (m[8] * m[4] - m[7] * m[5]),
            -scale * (m[8] * m[1] - m[7] * m[2]),
            scale * (m[5] * m[1] - m[4] * m[2]),

            -scale * (m[8] * m[3] - m[6] * m[5]),
            scale * (m[8] * m[0] - m[6] * m[2]),
            -scale * (m[5] * m[0] - m[3] * m[2]),

            scale * (m[7] * m[3] - m[6] * m[4]),
            -scale * (m[7] * m[0] - m[6] * m[1]),
            scale * (m[4] * m[0] - m[3] * m[1])
        ];

    };

    // /**
    //  * Inverts a 3x3 matrix.
    //  * @param {number[]} m matrix array of 12 points
    //  *       0 1 2
    //  *  0  [ 0 1 2 ]
    //  *  1  [ 3 4 5 ]
    //  *  2  [ 6 7 8 ]
    //  */
    // invertMatrix3(m) {

    //     var determinant =
    //         m[0] * (m[9] * m[4] - m[7] * m[4]) -
    //         m[3] * (m[9] * m[1] - m[7] * m[2]) +
    //         m[6] * (m[4] * m[1] - m[4] * m[2]);

    //     var scale = 1.0 / determinant;

    //     return [
    //         scale * (m[9] * m[4] - m[7] * m[4]),
    //         -scale * (m[9] * m[1] - m[7] * m[2]),
    //         scale * (m[4] * m[1] - m[4] * m[2]),

    //         -scale * (m[9] * m[3] - m[6] * m[4]),
    //         scale * (m[9] * m[0] - m[6] * m[2]),
    //         -scale * (m[4] * m[0] - m[3] * m[2]),

    //         scale * (m[7] * m[3] - m[6] * m[4]),
    //         -scale * (m[7] * m[0] - m[6] * m[1]),
    //         scale * (m[4] * m[0] - m[3] * m[1])
    //     ];
    // };

    ////////////////////////////////////////////////////////////////////////////////
    //
    //  Stage for applying Curves
    //

    /**
     * Applies a parametric curve to the input values.
     * @param {number[]} input - The input values.
     * @param {(import('./decode.js').CurveV4)[]} curves - The curve definitions.
     * @returns {number[]} - The output values after applying the curves.
     */

    stage_curves_parametric(input, curves) {
        var channels = input.length;
        var output = new Array(channels);
        for (var i = 0; i < channels; i++) {
            var c = curves[i];
            if (c.curveFn) output[i] = c.curveFn(c.params, input[i]);
            //output[i] = Math.min(Math.max(y, 0.0), 1.0);
        }
        return output;
    }

    /**
     * array input - Values 0.0 to 1.0
     * curve array of points in ICC V4 format
     *
     * @param {number[]} input
     * @param {(import('./decode.js').CurveV4)[]} curves  = Array of Curves - One for each Channel
     * @returns {number[]}
     */
    stage_curves_v4(input, curves) {
        var output;
        var channels = curves.length;
        if (channels === 3) {
            output = [0.0, 0.0, 0.0];
        } else {
            output = [0.0, 0.0, 0.0, 0.0];
        }
        for (var i = 0; i < channels; i++) {
            var c = curves[i];
            if (c.curveFn) {
                //
                // Use Parametric Function,
                // These are automatically inverted at creation in mAB or mAB
                //
                output[i] = c.curveFn(c.params, input[i]);
            } else {
                //
                // Interpolate the curve
                //
                var countMinus1 = c.count - 1;
                var p = input[i];
                if (p >= 1.0) {
                    output[i] = c.dataf[countMinus1];
                } else if (p <= 0.0) {
                    output[i] = c.dataf[0];
                } else {
                    var pX = p * (countMinus1);
                    var pX0 = Math.floor(pX);
                    var data0 = curves[i].dataf[pX0];
                    output[i] = (data0 + ((pX - pX0) * (curves[i].dataf[pX0 + 1] - data0)));
                }
            }
        }
        return output;
    };

    /**
     * array input - Values 0.0 to 1.0
     * curve array of points in ICC V2 format
     *
     * @param {number} input
     * @param {import('./decode.js').CurveV2} curve
     */
    stage_curve_v2(input, curve) {
        var offset = 0;

        var channels = curve.channels;
        var tableEntries = curve.entries;
        var tableEntriesMinus1 = tableEntries - 1;
        var tablef = curve.tablef;
        var output = new Array(channels);

        for (var i = 0; i < channels; i++) {
            var p = input[i];
            if (p >= 1.0) {
                output[i] = tablef[offset + tableEntriesMinus1];
            } else if (p <= 0.0) {
                output[i] = tablef[offset];
            } else {
                var pX = p * (tableEntriesMinus1); // scale to entries
                var pX0 = Math.floor(pX);
                var r = (pX - pX0);

                var y0 = tablef[offset + pX0];
                var y1 = tablef[offset + pX0 + 1];
                output[i] = y0 + ((y1 - y0) * r);
            }
            offset += tableEntries;
        }

        return output;
    };

    /**
     * 3D Trilinear interpolation - Slow - Tetrahedral is better EXCEPT PVC>Device
     *
     * With device LUT's White is one corner and black is the opposite corner, so the
     * data is encoded diagonally across the cube. This means that the tetrahedral
     * interpolation works well in this case and is faster than the trilinear.
     *
     * BUT for the PCS input, the data is encoded vertically from black to white
     * though the middle of the cube. with a/b horizontally and L vertically. This
     * means that in this special case the trilinear interpolation is more accurate.
     *
     * @param {number[]} input
     * @param {import('./decode.js').LUT} lut
     */
    trilinearInterp3D_NCh(input, lut) {
        // Use optimized implementation unless legacy mode is enabled
        if (!this.useLegacyInterpolation) {
            return trilinearInterp3D_NCh(input, lut);
        }

        // Legacy implementation
        return trilinearInterp3D_NCh_legacy(input, lut);
    };


    /**
     * 3D Trilinear interpolation - Slow - Tetrahedral is better
     * @param {number[]} input
     * @param  {import('./decode.js').LUT} lut
     * @param {number} [k0]
     */
    trilinearInterp3D_3or4Ch(input, lut, k0) {
        return trilinearInterp3D_3or4Ch(input, lut, k0);
    }

    /**
     * 4D Trilinear interpolation - Slow - Tetrahedral is better
     * @param {number[]} input
     * @param {import('./decode.js').LUT} lut
     */
    trilinearInterp4D_3or4Ch(input, lut) {
        return trilinearInterp4D_3or4Ch(input, lut);
    }

    /**
     * tetrahedralInterp3D_Master
     * Initalize the tetrahedral interpolation
     */
    tetrahedralInterp3D_Master(input, lut, K0) {
        return tetrahedralInterp3D_Master(input, lut, K0);
    }

    /**
     * Optimised version of tetrahedralInterp3D_Master
     * About 70% faster with functions combined
     * @param input
     * @param lut
     * @param K0
     * @returns {number[]}
     */
    tetrahedralInterp3D_3or4Ch(input, lut, K0) {
        // Use optimized implementation unless legacy mode is enabled
        if (!this.useLegacyInterpolation) {
            return tetrahedralInterp3D_3or4Ch(input, lut, K0);
        }

        // Legacy implementation
        return tetrahedralInterp3D_3or4Ch_legacy(input, lut, K0);
    }

    /**
     * PERFORMANCE LESSIONS
     *
     *  - Remove calls, inline functions
     *  - Don't save part calculations to temp valables
     *              FASTER  a=b*c*d and e=b*c*n
     *              SLOWER  temp=b*c, a=temp*d, e=temp*n - Suspect extra time to save and load variables is slower
     */

    linearInterp1D_NCh(input, lut) {
        // Use optimized implementation unless legacy mode is enabled
        if (!this.useLegacyInterpolation) {
            return linearInterp1D_NCh(input, lut);
        }

        // Legacy implementation - for now delegate to optimized as no separate legacy exists
        return linearInterp1D_NCh(input, lut);
    };

    bilinearInterp2D_NCh(input, lut) {
        // Use optimized implementation unless legacy mode is enabled
        if (!this.useLegacyInterpolation) {
            return bilinearInterp2D_NCh(input, lut);
        }

        // Legacy implementation - for now delegate to optimized as no separate legacy exists
        return bilinearInterp2D_NCh(input, lut);
    };

    /**
     * 3D Tetrahedral interpolation for 3D inputs and n Channels output
     * Used for PCS > 1,2 or nColour outputs
     * PCS > 3ch or PCS > 4ch have optimized versions for speed
     * @param input
     * @param lut
     * @returns {any[]}
     */
    tetrahedralInterp3D_NCh(input, lut) {
        return tetrahedralInterp3D_NCh(input, lut);
    }

    tetrahedralInterp3D_4Ch(input, lut) {
        // Use optimized implementation unless legacy mode is enabled
        if (!this.useLegacyInterpolation) {
            return tetrahedralInterp3D_4Ch(input, lut);
        }

        // Legacy implementation
        return tetrahedralInterp3D_4Ch_legacy(input, lut);
    };

    tetrahedralInterp3D_3Ch(input, lut) {
        // Use optimized implementation unless legacy mode is enabled
        if (!this.useLegacyInterpolation) {
            return tetrahedralInterp3D_3Ch(input, lut);
        }

        // Legacy implementation
        return tetrahedralInterp3D_3Ch_legacy(input, lut);
    };

    tetrahedralInterp4D_3Ch(input, lut) {
        return tetrahedralInterp4D_3Ch(input, lut);
    }

    tetrahedralInterp4D_4Ch(input, lut) {
        return tetrahedralInterp4D_4Ch(input, lut);
    };

    //UPDATED
    tetrahedralInterp4D_NCh(input, lut) {
        return tetrahedralInterp4D_NCh(input, lut);
    };


    tetrahedralInterp3DArray_4Ch_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        var rx, ry, rz;
        var X0, X1, Y0, Y1, Z0, Z1, px, py, pz, input0, input1, input2;
        var base1, base2, base3, base4,
            c0, c1, c2, c3, a, b;

        var outputScale = lut.outputScale;
        var gridPointsScale = (lut.g1 - 1) * lut.inputScale;
        var CLUT = lut.CLUT;
        var go0 = lut.go0;
        var go1 = lut.go1;
        var go2 = lut.go2;

        for (var p = 0; p < length; p++) {

            // We need some clipping here
            input0 = input[inputPos++];
            input1 = input[inputPos++];
            input2 = input[inputPos++];

            // No clipping checks for speed needed for clamped arrays

            // Rather than divide input by 255 then multiply by (lut.g1 - 1)
            // Just do this once, this means input0 stays an int and
            // only px needs to be a float
            px = input0 * gridPointsScale;
            py = input1 * gridPointsScale;
            pz = input2 * gridPointsScale;

            //
            // A few optimisations here, X0 is multiplied by go2, which is precalculated grid x outputChannels
            // Keeping input0 as int means we can just check input0 === 255 rather than input0 >= 1.0 as a float
            // And rather than X0+1 we can just do X0 + offset to location in lut
            X0 = ~~px; //~~ is the same as Math.floor(px)
            rx = (px - X0); // get the fractional part
            X0 *= go2; // change to index in array
            X1 = (input0 === 255) ? X0 : X0 + go2; // work out next index

            Y0 = ~~py;
            ry = (py - Y0);
            Y0 *= go1;
            Y1 = (input1 === 255) ? Y0 : Y0 + go1;

            Z0 = ~~pz;
            rz = (pz - Z0);
            Z0 *= go0;
            Z1 = (input2 === 255) ? Z0 : Z0 + go0;

            // Starting point in CLUT
            // Note that X0, Y0, Z0 are all multiplied by the grid offset and the outputChannels
            // So we only need additions rather than n = ((X0 * go2) + (Y0 * go1) + Z0)) * outputChannels
            base1 = X0 + Y0 + Z0;
            c0 = CLUT[base1++];
            c1 = CLUT[base1++];
            c2 = CLUT[base1++];
            c3 = CLUT[base1];

            if (rx >= ry && ry >= rz) {
                // block1
                base1 = X1 + Y0 + Z0;
                base2 = X1 + Y1 + Z0;
                //base3 = base1; SAME AS base1
                base4 = X1 + Y1 + Z1;
                //base5 = base2; SAME as base2

                // Important performance issues noted in Chrome and Firefox, assigning intermediate variables slows things down a lot
                // Just having one long line of code is much faster, I suspect internally all this math is done in registers,
                // as the JIT can see that variables are not used, so it can just do the math and store the result
                // If we were to use intermediate variables forces the compiler to read/write memory and potentially trigger the GC
                // However using a/b below to read only once from the array does appear to be faster, The less memory reads the better
                //
                // Note that baseN is increased after each read from the array to move to the next channel
                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                // Duno if this helps, but no need to increase base1/2/3/4 again as we are done with them
                a = CLUT[base1];
                b = CLUT[base2];
                output[outputPos++] = (c3 + ((a - c3) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;

            } else if (rx >= rz && rz >= ry) {
                // block2

                base1 = X1 + Y0 + Z0;
                base2 = X1 + Y1 + Z1;
                base3 = X1 + Y0 + Z1;
                //base4 = base3;
                //base5 = base1;

                a = CLUT[base3++];
                b = CLUT[base1++];
                output[outputPos++] = (c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base3++];
                b = CLUT[base1++];
                output[outputPos++] = (c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base3++];
                b = CLUT[base1++];
                output[outputPos++] = (c2 + ((b - c2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base3];
                b = CLUT[base1];
                output[outputPos++] = (c3 + ((b - c3) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) * outputScale;

            } else if (rx >= ry && rz >= rx) {
                // block3

                base1 = X1 + Y0 + Z1;
                base2 = X0 + Y0 + Z1;
                base3 = X1 + Y1 + Z1;
                //base4 = base1;
                //base5 = base2;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c2) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c3 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c3) * rz)) * outputScale;

            } else if (ry >= rx && rx >= rz) {
                // block4

                base1 = X1 + Y1 + Z0;
                base2 = X0 + Y1 + Z0;
                //base3 = base2;
                base4 = X1 + Y1 + Z1;
                //base5 = base1;

                a = CLUT[base2++];
                b = CLUT[base1++];
                output[outputPos++] = (c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base1++];
                output[outputPos++] = (c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base1++];
                output[outputPos++] = (c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base2];
                b = CLUT[base1];
                output[outputPos++] = (c3 + ((b - a) * rx) + ((a - c3) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;

            } else if (ry >= rz && rz >= rx) {
                // block5

                base1 = X1 + Y1 + Z1;
                base2 = X0 + Y1 + Z1;
                base3 = X0 + Y1 + Z0;
                //base4 = base2;
                //base5 = base3;

                a = CLUT[base2++];
                b = CLUT[base3++];
                output[outputPos++] = (c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base3++];
                output[outputPos++] = (c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base3++];
                output[outputPos++] = (c2 + ((CLUT[base1++] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base3++];
                output[outputPos++] = (c3 + ((CLUT[base1++] - a) * rx) + ((b - c3) * ry) + ((a - b) * rz)) * outputScale;

            } else if (rz >= ry && ry >= rx) {
                // block6

                base1 = X1 + Y1 + Z1;
                base2 = X0 + Y1 + Z1;
                //base3 = base2;
                base4 = X0 + Y0 + Z1;
                //base5 = base4;

                a = CLUT[base2++];
                b = CLUT[base4++];
                output[outputPos++] = (c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base4++];
                output[outputPos++] = (c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base4++];
                output[outputPos++] = (c2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz)) * outputScale;

                a = CLUT[base2];
                b = CLUT[base4];
                output[outputPos++] = (c3 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c3) * rz)) * outputScale;

            } else {
                output[outputPos++] = c0 * outputScale;
                output[outputPos++] = c1 * outputScale;
                output[outputPos++] = c2 * outputScale;
                output[outputPos++] = c3 * outputScale;

            }

            if (preserveAlpha) {
                output[outputPos++] = input[inputPos++];
            } else {
                if (inputHasAlpha) { inputPos++; }
                if (outputHasAlpha) {
                    output[outputPos++] = 255;
                }
            }

        }
    };

    linearInterp1DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        return linearInterp1DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
    };

    /**
     * Bilinear interpolation - NOT optimized for speed YET
     * @param input
     * @param inputPos
     * @param output
     * @param outputPos
     * @param length
     * @param lut
     * @param inputHasAlpha
     * @param outputHasAlpha
     * @param preserveAlpha
     */
    bilinearInterp2DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        var colorIn, temp, o;
        var outputChannels = lut.outputChannels;
        colorIn = new Uint8ClampedArray(2);
        for (var p = 0; p < length; p++) {
            colorIn[0] = input[inputPos++];
            colorIn[1] = input[inputPos++];
            temp = this.bilinearInterp2D_NCh(colorIn, lut);
            for (let o = 0; o < outputChannels; o++) {
                output[outputPos++] = temp[o];
            }
            if (preserveAlpha) {
                output[outputPos++] = input[inputPos++];
            } else {
                if (inputHasAlpha) { inputPos++; }
                if (outputHasAlpha) {
                    output[outputPos++] = 255;
                }
            }
        }
    };

    tetrahedralInterp3DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        return tetrahedralInterp3DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
    }

    //UPDATED
    tetrahedralInterp4DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        var colorIn, temp, o;
        var outputChannels = lut.outputChannels;
        colorIn = new Uint8ClampedArray(4);
        for (var p = 0; p < length; p++) {
            colorIn[0] = input[inputPos++];
            colorIn[1] = input[inputPos++];
            colorIn[2] = input[inputPos++];
            colorIn[3] = input[inputPos++];
            temp = this.tetrahedralInterp4D_NCh(colorIn, lut);
            for (let o = 0; o < outputChannels; o++) {
                output[outputPos++] = temp[o];
            }
            if (preserveAlpha) {
                output[outputPos++] = input[inputPos++];
            } else {
                if (inputHasAlpha) { inputPos++; }
                if (outputHasAlpha) {
                    output[outputPos++] = 255;
                }
            }
        }
    }

    tetrahedralInterp3DArray_3Ch_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        var rx, ry, rz,
            X0, X1, Y0,
            Y1, Z0, Z1,
            px, py, pz,
            input0, input1, input2;
        var base1, base2, base3, base4,
            c0, c1, c2, a, b;

        var outputScale = lut.outputScale;
        var gridPointsScale = (lut.g1 - 1) * lut.inputScale;
        var CLUT = lut.CLUT;
        var go0 = lut.go0;
        var go1 = lut.go1;
        var go2 = lut.go2;

        for (var p = 0; p < length; p++) {

            // We need some clipping here
            input0 = input[inputPos++];
            input1 = input[inputPos++];
            input2 = input[inputPos++];

            // No clipping checks for speed needed for clamped arrays

            // Rather than divide input by 255 then multiply by (lut.g1 - 1)
            // Just do this once, this means input0 stays an int and
            // only px needs to be a float
            px = input0 * gridPointsScale;
            py = input1 * gridPointsScale;
            pz = input2 * gridPointsScale;

            //
            // A few optimisations here, X0 is multiplied by go2, which is precalculated grid x outputChannels
            // Keeping input0 as int means we can just check input0 === 255 rather than input0 >= 1.0 as a float
            // And rather than X0+1 we can just do X0 + offset to location in lut
            X0 = ~~px; //~~ is the same as Math.floor(px)
            rx = (px - X0); // get the fractional part
            X0 *= go2; // change to index in array
            X1 = (input0 === 255) ? X0 : X0 + go2; // work out next index

            Y0 = ~~py;
            ry = (py - Y0);
            Y0 *= go1;
            Y1 = (input1 === 255) ? Y0 : Y0 + go1;

            Z0 = ~~pz;
            rz = (pz - Z0);
            Z0 *= go0;
            Z1 = (input2 === 255) ? Z0 : Z0 + go0;

            // Starting point in CLUT
            // Note that X0, Y0, Z0 are all multiplied by the grid offset and the outputChannels
            // So we only need additions rather than n = ((X0 * go2) + (Y0 * go1) + Z0)) * outputChannels
            base1 = X0 + Y0 + Z0;
            c0 = CLUT[base1++];
            c1 = CLUT[base1++];
            c2 = CLUT[base1];

            if (rx >= ry && ry >= rz) {
                // block1
                base1 = X1 + Y0 + Z0;
                base2 = X1 + Y1 + Z0;
                //base3 = base1; SAME AS base1
                base4 = X1 + Y1 + Z1;
                //base5 = base2; SAME as base2

                // Important performance issues noted in Chrome and Firefox, assigning intermediate variables slows things down a lot
                // Just having one long line of code is much faster, I suspect internally all this math is done in registers,
                // as the JIT can see that variables are not used, so it can just do the math and store the result
                // If we were to use intermediate variables forces the compiler to read/write memory and potentially trigger the GC
                // However using a/b below to read only once from the array does appear to be faster, The less memory reads the better
                //
                // Note that baseN is increased after each read from the array to move to the next channel
                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base1];
                b = CLUT[base2];
                output[outputPos++] = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;


            } else if (rx >= rz && rz >= ry) {
                // block2

                base1 = X1 + Y0 + Z0;
                base2 = X1 + Y1 + Z1;
                base3 = X1 + Y0 + Z1;
                //base4 = base3;
                //base5 = base1;

                a = CLUT[base3++];
                b = CLUT[base1++];
                output[outputPos++] = (c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base3++];
                b = CLUT[base1++];
                output[outputPos++] = (c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base3];
                b = CLUT[base1];
                output[outputPos++] = (c2 + ((b - c2) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) * outputScale;



            } else if (rx >= ry && rz >= rx) {
                // block3

                base1 = X1 + Y0 + Z1;
                base2 = X0 + Y0 + Z1;
                base3 = X1 + Y1 + Z1;
                //base4 = base1;
                //base5 = base2;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz)) * outputScale;

                a = CLUT[base1++];
                b = CLUT[base2++];
                output[outputPos++] = (c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz)) * outputScale;

                a = CLUT[base1];
                b = CLUT[base2];
                output[outputPos++] = (c2 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c2) * rz)) * outputScale;



            } else if (ry >= rx && rx >= rz) {
                // block4

                base1 = X1 + Y1 + Z0;
                base2 = X0 + Y1 + Z0;
                //base3 = base2;
                base4 = X1 + Y1 + Z1;
                //base5 = base1;

                a = CLUT[base2++];
                b = CLUT[base1++];
                output[outputPos++] = (c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base1++];
                output[outputPos++] = (c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

                a = CLUT[base2];
                b = CLUT[base1];
                output[outputPos++] = (c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;


            } else if (ry >= rz && rz >= rx) {
                // block5

                base1 = X1 + Y1 + Z1;
                base2 = X0 + Y1 + Z1;
                base3 = X0 + Y1 + Z0;
                //base4 = base2;
                //base5 = base3;

                a = CLUT[base2++];
                b = CLUT[base3++];
                output[outputPos++] = (c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base3++];
                output[outputPos++] = (c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz)) * outputScale;

                a = CLUT[base2];
                b = CLUT[base3];
                output[outputPos++] = (c2 + ((CLUT[base1] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz)) * outputScale;


            } else if (rz >= ry && ry >= rx) {
                // block6

                base1 = X1 + Y1 + Z1;
                base2 = X0 + Y1 + Z1;
                //base3 = base2;
                base4 = X0 + Y0 + Z1;
                //base5 = base4;

                a = CLUT[base2++];
                b = CLUT[base4++];
                output[outputPos++] = (c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz)) * outputScale;

                a = CLUT[base2++];
                b = CLUT[base4++];
                output[outputPos++] = (c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz)) * outputScale;

                a = CLUT[base2];
                b = CLUT[base4];
                output[outputPos++] = (c2 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz)) * outputScale;

            } else {
                output[outputPos++] = c0 * outputScale;
                output[outputPos++] = c1 * outputScale;
                output[outputPos++] = c2 * outputScale;
            }
        }

        if (preserveAlpha) {
            output[outputPos++] = input[inputPos++];
        } else {
            if (inputHasAlpha) { inputPos++; }
            if (outputHasAlpha) {
                output[outputPos++] = 255;
            }
        }
    };

    //UPDATED
    tetrahedralInterp4DArray_3Ch_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        var X0, X1, Y0, K0,
            Y1, Z0, Z1,
            rx, ry, rz, rk,
            px, py, pz, pk,
            input0, input1, input2, inputK,
            base1, base2, base3, base4,
            c0, c1, c2,
            o0, o1, o2,
            d0, d1, d2,
            a, b,
            interpK;

        var outputScale = lut.outputScale;
        var gridPointsScale = (lut.g1 - 1) * lut.inputScale;
        var CLUT = lut.CLUT;
        var go0 = lut.go0;
        var go1 = lut.go1;
        var go2 = lut.go2;
        var go3 = lut.go3;
        var kOffset = go3 - lut.outputChannels + 1; // +1 since we don't do a [base++] for the last CLUT lookup

        for (var p = 0; p < length; p++) {

            // We need some clipping here
            inputK = input[inputPos++]; // K
            input0 = input[inputPos++]; // C
            input1 = input[inputPos++]; // M
            input2 = input[inputPos++]; // Y


            // No clipping checks for speed needed for clamped arrays

            px = input0 * gridPointsScale;
            py = input1 * gridPointsScale;
            pz = input2 * gridPointsScale;
            pk = inputK * gridPointsScale;

            K0 = ~~pk;
            rk = (pk - K0);
            K0 *= go3;
            // K1 is not required, we just need to test if
            // we need to interpolate or not

            X0 = ~~px; //~~ is the same as Math.floor(px)
            rx = (px - X0); // get the fractional part
            X0 *= go2; // change to index in array
            X1 = (input0 === 255) ? X0 : X0 + go2; // work out next index

            Y0 = ~~py;
            ry = (py - Y0);
            Y0 *= go1;
            Y1 = (input1 === 255) ? Y0 : Y0 + go1;

            Z0 = ~~pz;
            rz = (pz - Z0);
            Z0 *= go0;
            Z1 = (input2 === 255) ? Z0 : Z0 + go0;

            base1 = X0 + Y0 + Z0 + K0;
            c0 = CLUT[base1++];
            c1 = CLUT[base1++];
            c2 = CLUT[base1];

            if (inputK === 255 || rk === 0) {
                interpK = false;
            } else {
                base1 += kOffset;
                d0 = CLUT[base1++];
                d1 = CLUT[base1++];
                d2 = CLUT[base1];
                interpK = true;
            }

            if (rx >= ry && ry >= rz) {
                // block1
                base1 = X1 + Y0 + Z0 + K0;
                base2 = X1 + Y1 + Z0 + K0;
                //base3 = base1; SAME AS base1
                base4 = X1 + Y1 + Z1 + K0;
                //base5 = base2; SAME as base2

                // Note that baseN is increased after each read from the array to move to the next channel
                a = CLUT[base1++];
                b = CLUT[base2++];
                o0 = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

                a = CLUT[base1++];
                b = CLUT[base2++];
                o1 = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

                a = CLUT[base1];
                b = CLUT[base2];
                o2 = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz));

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base4 += kOffset;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    //output[outputPos++] = c1 + (( d1 - c1 ) * rk)
                    output[outputPos++] = (o0 + (((d0 + ((a - d0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o1 + (((d1 + ((a - d1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o2 + (((d2 + ((a - d2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o2) * rk)) * outputScale;

                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                }

            } else if (rx >= rz && rz >= ry) {
                // block2

                base1 = X1 + Y0 + Z0 + K0;
                base2 = X1 + Y1 + Z1 + K0;
                base3 = X1 + Y0 + Z1 + K0;
                //base4 = base3;
                //base5 = base1;

                a = CLUT[base3++];
                b = CLUT[base1++];
                o0 = c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

                a = CLUT[base3++];
                b = CLUT[base1++];
                o1 = c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

                a = CLUT[base3];
                b = CLUT[base1];
                o2 = c2 + ((b - c2) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz);


                if (interpK) {
                    base3 += kOffset;
                    base1 += kOffset;
                    base2 += kOffset;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o0 + (((d0 + ((b - d0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o1 + (((d1 + ((b - d1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o2 + (((d2 + ((b - d2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                }

            } else if (rx >= ry && rz >= rx) {
                // block3

                base1 = X1 + Y0 + Z1 + K0;
                base2 = X0 + Y0 + Z1 + K0;
                base3 = X1 + Y1 + Z1 + K0;
                //base4 = base1;
                //base5 = base2;

                a = CLUT[base1++];
                b = CLUT[base2++];
                o0 = c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz);

                a = CLUT[base1++];
                b = CLUT[base2++];
                o1 = c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz);

                a = CLUT[base1];
                b = CLUT[base2];
                o2 = c2 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c2) * rz);


                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base3 += kOffset;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o0 + (((d0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - d0) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o1 + (((d1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - d1) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o2 + (((d2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - d2) * rz)) - o2) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                }

            } else if (ry >= rx && rx >= rz) {
                // block4

                base1 = X1 + Y1 + Z0 + K0;
                base2 = X0 + Y1 + Z0 + K0;
                //base3 = base2;
                base4 = X1 + Y1 + Z1 + K0;
                //base5 = base1;

                a = CLUT[base2++];
                b = CLUT[base1++];
                o0 = c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz);

                a = CLUT[base2++];
                b = CLUT[base1++];
                o1 = c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz);

                a = CLUT[base2];
                b = CLUT[base1];
                o2 = c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4] - b) * rz);


                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base4 += kOffset;

                    a = CLUT[base2++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o0 + (((d0 + ((b - a) * rx) + ((a - d0) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o1 + (((d1 + ((b - a) * rx) + ((a - d1) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o2 + (((d2 + ((b - a) * rx) + ((a - d2) * ry) + ((CLUT[base4++] - b) * rz)) - o2) * rk)) * outputScale;

                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                }

            } else if (ry >= rz && rz >= rx) {
                // block5

                base1 = X1 + Y1 + Z1 + K0;
                base2 = X0 + Y1 + Z1 + K0;
                base3 = X0 + Y1 + Z0 + K0;
                //base4 = base2;
                //base5 = base3;

                a = CLUT[base2++];
                b = CLUT[base3++];
                o0 = c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz);

                a = CLUT[base2++];
                b = CLUT[base3++];
                o1 = c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz);

                a = CLUT[base2];
                b = CLUT[base3];
                o2 = c2 + ((CLUT[base1] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz);

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base3 += kOffset;

                    a = CLUT[base2++];
                    b = CLUT[base3++];
                    output[outputPos++] = (o0 + (((d0 + ((CLUT[base1++] - a) * rx) + ((b - d0) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base3++];
                    output[outputPos++] = (o1 + (((d1 + ((CLUT[base1++] - a) * rx) + ((b - d1) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base3++];
                    output[outputPos++] = (o2 + (((d2 + ((CLUT[base1++] - a) * rx) + ((b - d2) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                }

            } else if (rz >= ry && ry >= rx) {
                // block6

                base1 = X1 + Y1 + Z1 + K0;
                base2 = X0 + Y1 + Z1 + K0;
                //base3 = base2;
                base4 = X0 + Y0 + Z1 + K0;
                //base5 = base4;

                a = CLUT[base2++];
                b = CLUT[base4++];
                o0 = c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz);

                a = CLUT[base2++];
                b = CLUT[base4++];
                o1 = c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz);

                a = CLUT[base2];
                b = CLUT[base4];
                o2 = c2 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz);

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base4 += kOffset;

                    a = CLUT[base2++];
                    b = CLUT[base4++];
                    output[outputPos++] = (o0 + (((d0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - d0) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base4++];
                    output[outputPos++] = (o1 + (((d1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - d1) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base4++];
                    output[outputPos++] = (o2 + (((d2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - d2) * rz)) - o2) * rk)) * outputScale;

                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                }

            } else {
                if (interpK) {
                    output[outputPos++] = c0 + ((d0 - c0) * rk) * outputScale;
                    output[outputPos++] = c1 + ((d1 - c1) * rk) * outputScale;
                    output[outputPos++] = c2 + ((d2 - c2) * rk) * outputScale;
                } else {
                    output[outputPos++] = c0 * outputScale;
                    output[outputPos++] = c1 * outputScale;
                    output[outputPos++] = c2 * outputScale;
                }
            }

            if (preserveAlpha) {
                output[outputPos++] = input[inputPos++];
            } else {
                if (inputHasAlpha) { inputPos++; }
                if (outputHasAlpha) {
                    output[outputPos++] = 255;
                }
            }
        }
    };

    //UPDATED
    tetrahedralInterp4DArray_4Ch_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
        var X0, X1, Y0, K0,
            Y1, Z0, Z1,
            rx, ry, rz, rk,
            px, py, pz, pk,
            input0, input1, input2, inputK,
            base1, base2, base3, base4,
            c0, c1, c2, c3,
            o0, o1, o2, o3,
            k0, k1, k2, k3,
            a, b,
            interpK;

        var outputScale = lut.outputScale;
        var gridPointsScale = (lut.g1 - 1) * lut.inputScale;
        var CLUT = lut.CLUT;
        var go0 = lut.go0;
        var go1 = lut.go1;
        var go2 = lut.go2;
        var go3 = lut.go3;
        var kOffset = go3 - lut.outputChannels + 1; // +1 since we don't do a [base++] for the last CLUT lookup

        for (var p = 0; p < length; p++) {

            // We need some clipping here
            inputK = input[inputPos++]; // K
            input0 = input[inputPos++]; // C
            input1 = input[inputPos++]; // M
            input2 = input[inputPos++]; // Y

            // No clipping checks for speed needed for clamped arrays
            px = input0 * gridPointsScale;
            py = input1 * gridPointsScale;
            pz = input2 * gridPointsScale;
            pk = inputK * gridPointsScale;

            K0 = ~~pk;
            rk = (pk - K0);
            K0 *= go3;
            // K1 is not required, we just need to test if
            // we need to interpolate or not

            X0 = ~~px; //~~ is the same as Math.floor(px)
            rx = (px - X0); // get the fractional part
            X0 *= go2; // change to index in array
            X1 = (input0 === 255) ? X0 : X0 + go2; // work out next index

            Y0 = ~~py;
            ry = (py - Y0);
            Y0 *= go1;
            Y1 = (input1 === 255) ? Y0 : Y0 + go1;

            Z0 = ~~pz;
            rz = (pz - Z0);
            Z0 *= go0;
            Z1 = (input2 === 255) ? Z0 : Z0 + go0;

            base1 = X0 + Y0 + Z0 + K0;

            base1 = X0 + Y0 + Z0 + K0;
            c0 = CLUT[base1++];
            c1 = CLUT[base1++];
            c2 = CLUT[base1++];
            c3 = CLUT[base1];

            if (inputK === 255 || rk === 0) {
                interpK = false;
            } else {
                base1 += kOffset;
                k0 = CLUT[base1++];
                k1 = CLUT[base1++];
                k2 = CLUT[base1++];
                k3 = CLUT[base1];
                interpK = true;
            }

            if (rx >= ry && ry >= rz) {
                // block1
                base1 = X1 + Y0 + Z0 + K0;
                base2 = X1 + Y1 + Z0 + K0;
                //base3 = base1; SAME AS base1
                base4 = X1 + Y1 + Z1 + K0;
                //base5 = base2; SAME as base2

                // Note that baseN is increased after each read from the array to move to the next channel
                a = CLUT[base1++];
                b = CLUT[base2++];
                o0 = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

                a = CLUT[base1++];
                b = CLUT[base2++];
                o1 = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

                a = CLUT[base1++];
                b = CLUT[base2++];
                o2 = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

                a = CLUT[base1];
                b = CLUT[base2];
                o3 = (c3 + ((a - c3) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz));

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base4 += kOffset;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    //output[outputPos++] = c1 + (( d1 - c1 ) * rk)
                    output[outputPos++] = (o0 + (((k0 + ((a - k0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o1 + (((k1 + ((a - k1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o2 + (((k2 + ((a - k2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o2) * rk)) * outputScale;

                    a = CLUT[base1];
                    b = CLUT[base2];
                    output[outputPos++] = (o3 + (((k3 + ((a - k3) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o3) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                    output[outputPos++] = o3 * outputScale;
                }

            } else if (rx >= rz && rz >= ry) {
                // block2

                base1 = X1 + Y0 + Z0 + K0;
                base2 = X1 + Y1 + Z1 + K0;
                base3 = X1 + Y0 + Z1 + K0;
                //base4 = base3;
                //base5 = base1;

                a = CLUT[base3++];
                b = CLUT[base1++];
                o0 = c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

                a = CLUT[base3++];
                b = CLUT[base1++];
                o1 = c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

                a = CLUT[base3++];
                b = CLUT[base1++];
                o2 = c2 + ((b - c2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

                a = CLUT[base3];
                b = CLUT[base1];
                o3 = c3 + ((b - c3) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz);

                if (interpK) {
                    base3 += kOffset;
                    base1 += kOffset;
                    base2 += kOffset;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o0 + (((k0 + ((b - k0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o1 + (((k1 + ((b - k1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o2 + (((k2 + ((b - k2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

                    a = CLUT[base3++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o3 + (((k3 + ((b - k3) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) - o3) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                    output[outputPos++] = o3 * outputScale;
                }

            } else if (rx >= ry && rz >= rx) {
                // block3

                base1 = X1 + Y0 + Z1 + K0;
                base2 = X0 + Y0 + Z1 + K0;
                base3 = X1 + Y1 + Z1 + K0;
                //base4 = base1;
                //base5 = base2;

                a = CLUT[base1++];
                b = CLUT[base2++];
                o0 = c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz);

                a = CLUT[base1++];
                b = CLUT[base2++];
                o1 = c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz);

                a = CLUT[base1++];
                b = CLUT[base2++];
                o2 = c2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c2) * rz);

                a = CLUT[base1];
                b = CLUT[base2];
                o3 = c3 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c3) * rz);

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base3 += kOffset;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o0 + (((k0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - k0) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o1 + (((k1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - k1) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base1++];
                    b = CLUT[base2++];
                    output[outputPos++] = (o2 + (((k2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - k2) * rz)) - o2) * rk)) * outputScale;

                    a = CLUT[base1];
                    b = CLUT[base2];
                    output[outputPos++] = (o3 + (((k3 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - k3) * rz)) - o3) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                    output[outputPos++] = o3 * outputScale;
                }

            } else if (ry >= rx && rx >= rz) {
                // block4

                base1 = X1 + Y1 + Z0 + K0;
                base2 = X0 + Y1 + Z0 + K0;
                //base3 = base2;
                base4 = X1 + Y1 + Z1 + K0;
                //base5 = base1;

                a = CLUT[base2++];
                b = CLUT[base1++];
                o0 = c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz);

                a = CLUT[base2++];
                b = CLUT[base1++];
                o1 = c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz);

                a = CLUT[base2++];
                b = CLUT[base1++];
                o2 = c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4++] - b) * rz);

                a = CLUT[base2];
                b = CLUT[base1];
                o3 = c3 + ((b - a) * rx) + ((a - c3) * ry) + ((CLUT[base4] - b) * rz);

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base4 += kOffset;

                    a = CLUT[base2++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o0 + (((k0 + ((b - a) * rx) + ((a - k0) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o1 + (((k1 + ((b - a) * rx) + ((a - k1) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base1++];
                    output[outputPos++] = (o2 + (((k2 + ((b - a) * rx) + ((a - k2) * ry) + ((CLUT[base4++] - b) * rz)) - o2) * rk)) * outputScale;

                    a = CLUT[base2];
                    b = CLUT[base1];
                    output[outputPos++] = (o3 + (((k3 + ((b - a) * rx) + ((a - k3) * ry) + ((CLUT[base4] - b) * rz)) - o3) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                    output[outputPos++] = o3 * outputScale;
                }

            } else if (ry >= rz && rz >= rx) {
                // block5

                base1 = X1 + Y1 + Z1 + K0;
                base2 = X0 + Y1 + Z1 + K0;
                base3 = X0 + Y1 + Z0 + K0;
                //base4 = base2;
                //base5 = base3;

                a = CLUT[base2++];
                b = CLUT[base3++];
                o0 = c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz);

                a = CLUT[base2++];
                b = CLUT[base3++];
                o1 = c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz);

                a = CLUT[base2++];
                b = CLUT[base3++];
                o2 = c2 + ((CLUT[base1++] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz);

                a = CLUT[base2];
                b = CLUT[base3];
                o3 = c3 + ((CLUT[base1] - a) * rx) + ((b - c3) * ry) + ((a - b) * rz);

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base3 += kOffset;

                    a = CLUT[base2++];
                    b = CLUT[base3++];
                    output[outputPos++] = (o0 + (((k0 + ((CLUT[base1++] - a) * rx) + ((b - k0) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base3++];
                    output[outputPos++] = (o1 + (((k1 + ((CLUT[base1++] - a) * rx) + ((b - k1) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base3++];
                    output[outputPos++] = (o2 + (((k2 + ((CLUT[base1++] - a) * rx) + ((b - k2) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

                    a = CLUT[base2];
                    b = CLUT[base3];
                    output[outputPos++] = (o3 + (((k3 + ((CLUT[base1++] - a) * rx) + ((b - k3) * ry) + ((a - b) * rz)) - o3) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                    output[outputPos++] = o3 * outputScale;
                }

            } else if (rz >= ry && ry >= rx) {
                // block6

                base1 = X1 + Y1 + Z1 + K0;
                base2 = X0 + Y1 + Z1 + K0;
                //base3 = base2;
                base4 = X0 + Y0 + Z1 + K0;
                //base5 = base4;

                a = CLUT[base2++];
                b = CLUT[base4++];
                o0 = c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz);

                a = CLUT[base2++];
                b = CLUT[base4++];
                o1 = c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz);

                a = CLUT[base2++];
                b = CLUT[base4++];
                o2 = c2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz);

                a = CLUT[base2];
                b = CLUT[base4];
                o3 = c3 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c3) * rz);

                if (interpK) {
                    base1 += kOffset;
                    base2 += kOffset;
                    base4 += kOffset;

                    a = CLUT[base2++];
                    b = CLUT[base4++];
                    output[outputPos++] = (o0 + (((k0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - k0) * rz)) - o0) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base4++];
                    output[outputPos++] = (o1 + (((k1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - k1) * rz)) - o1) * rk)) * outputScale;

                    a = CLUT[base2++];
                    b = CLUT[base4++];
                    output[outputPos++] = (o2 + (((k2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - k2) * rz)) - o2) * rk)) * outputScale;

                    a = CLUT[base2];
                    b = CLUT[base4];
                    output[outputPos++] = (o3 + (((k3 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - k3) * rz)) - o3) * rk)) * outputScale;
                } else {
                    output[outputPos++] = o0 * outputScale;
                    output[outputPos++] = o1 * outputScale;
                    output[outputPos++] = o2 * outputScale;
                    output[outputPos++] = o3 * outputScale;
                }

            } else {
                if (interpK) {
                    output[outputPos++] = c0 + ((k0 - c0) * rk) * outputScale;
                    output[outputPos++] = c1 + ((k1 - c1) * rk) * outputScale;
                    output[outputPos++] = c2 + ((k2 - c2) * rk) * outputScale;
                    output[outputPos++] = c3 + ((k3 - c3) * rk) * outputScale;
                } else {
                    output[outputPos++] = c0 * outputScale;
                    output[outputPos++] = c1 * outputScale;
                    output[outputPos++] = c2 * outputScale;
                    output[outputPos++] = c3 * outputScale;
                }
            }

            if (preserveAlpha) {
                output[outputPos++] = input[inputPos++];
            } else {
                if (inputHasAlpha) { inputPos++; }
                if (outputHasAlpha) {
                    output[outputPos++] = 255;
                }
            }
        }
    };


    tetrahedralInterp3DArray_4Ch_16bit(input, inputPos, output, outputPos, length, lut) {
        var rx, ry, rz;
        var X0, X1, Y0, Y1, Z0, Z1, px, py, pz, input0, input1, input2;
        var base1, base2,
            c00, c01, c02, c03,
            c10, c11, c12, c13,
            c20, c21, c22, c23,
            c30, c31, c32, c33;

        var outputScale = lut.outputScale;
        var outputChannels = lut.outputChannels;
        var gridPointsMinus1 = lut.g1 - 1;
        var CLUT = lut.CLUT;
        var go1 = lut.go1;
        var go2 = lut.go2;

        for (var p = 0; p < length; p++) {

            // We need some clipping here
            input0 = input[inputPos++];
            input1 = input[inputPos++];
            input2 = input[inputPos++];

            // No clipping checks for speed needed for clamped arrays

            px = input0 * gridPointsMinus1 / 255;
            py = input1 * gridPointsMinus1 / 255;
            pz = input2 * gridPointsMinus1 / 255;

            X0 = Math.floor(px);
            rx = input0;
            X1 = (input0 === 255) ? X0 : X0 + 1;

            Y0 = Math.floor(py);
            ry = input1;
            Y1 = (input1 === 255) ? Y0 : Y0 + 1;

            Z0 = Math.floor(pz);
            rz = input2;
            Z1 = (input2 === 255) ? Z0 : Z0 + 1;

            Z0 *= outputChannels;
            Z1 *= outputChannels;

            //c0 = lookup(X0, Y0, Z0);
            base1 = ((X0 * go2) + (Y0 * go1) + Z0);
            c00 = CLUT[base1++];
            c01 = CLUT[base1++];
            c02 = CLUT[base1++];
            c03 = CLUT[base1];

            if (rx >= ry && ry >= rz) {
                // block1
                // X1, Y0, Z0, c0);
                base1 = ((X1 * go2) + (Y0 * go1) + Z0);
                c10 = CLUT[base1++] - c00;
                c11 = CLUT[base1++] - c01;
                c12 = CLUT[base1++] - c02;
                c13 = CLUT[base1] - c03;

                // X1, Y1, Z0,
                // X1, Y0, Z0);
                base1 = ((X1 * go2) + (Y1 * go1) + Z0);
                base2 = ((X1 * go2) + (Y0 * go1) + Z0);
                c20 = CLUT[base1++] - CLUT[base2++];
                c21 = CLUT[base1++] - CLUT[base2++];
                c22 = CLUT[base1++] - CLUT[base2++];
                c23 = CLUT[base1] - CLUT[base2];

                // X1, Y1, Z1,
                // X1, Y1, Z0);
                base1 = ((X1 * go2) + (Y1 * go1) + Z1);
                base2 = ((X1 * go2) + (Y1 * go1) + Z0);
                c30 = CLUT[base1++] - CLUT[base2++];
                c31 = CLUT[base1++] - CLUT[base2++];
                c32 = CLUT[base1++] - CLUT[base2++];
                c33 = CLUT[base1] - CLUT[base2];

            } else if (rx >= rz && rz >= ry) {
                // block2
                // X1, Y0, Z0, c0);
                base1 = ((X1 * go2) + (Y0 * go1) + Z0);
                c10 = CLUT[base1++] - c00;
                c11 = CLUT[base1++] - c01;
                c12 = CLUT[base1++] - c02;
                c13 = CLUT[base1] - c03;

                // X1, Y1, Z1,
                // X1, Y0, Z1)
                base1 = ((X1 * go2) + (Y1 * go1) + Z1);
                base2 = ((X1 * go2) + (Y0 * go1) + Z1);
                c20 = CLUT[base1++] - CLUT[base2++];
                c21 = CLUT[base1++] - CLUT[base2++];
                c22 = CLUT[base1++] - CLUT[base2++];
                c23 = CLUT[base1] - CLUT[base2];

                // X1, Y0, Z1,
                // X1, Y0, Z0);
                base1 = ((X1 * go2) + (Y0 * go1) + Z1);
                base2 = ((X1 * go2) + (Y0 * go1) + Z0);
                c30 = CLUT[base1++] - CLUT[base2++];
                c31 = CLUT[base1++] - CLUT[base2++];
                c32 = CLUT[base1++] - CLUT[base2++];
                c33 = CLUT[base1] - CLUT[base2];

            } else if (rz >= rx && rx >= ry) {
                // block3
                // X1, Y0, Z1,
                // X0, Y0, Z1);
                base1 = ((X1 * go2) + (Y0 * go1) + Z1);
                base2 = ((X0 * go2) + (Y0 * go1) + Z1);
                c10 = CLUT[base1++] - CLUT[base2++];
                c11 = CLUT[base1++] - CLUT[base2++];
                c12 = CLUT[base1++] - CLUT[base2++];
                c13 = CLUT[base1] - CLUT[base2];

                // X1, Y1, Z1,
                // X1, Y0, Z1);
                base1 = ((X1 * go2) + (Y1 * go1) + Z1);
                base2 = ((X1 * go2) + (Y0 * go1) + Z1);
                c20 = CLUT[base1++] - CLUT[base2++];
                c21 = CLUT[base1++] - CLUT[base2++];
                c22 = CLUT[base1++] - CLUT[base2++];
                c23 = CLUT[base1] - CLUT[base2];

                // X0, Y0, Z1, c0);
                base1 = ((X0 * go2) + (Y0 * go1) + Z1);
                c30 = CLUT[base1++] - c00;
                c31 = CLUT[base1++] - c01;
                c32 = CLUT[base1++] - c02;
                c33 = CLUT[base1] - c03;

            } else if (ry >= rx && rx >= rz) {
                // block4

                //  X1, Y1, Z0,
                //  X0, Y1, Z0);
                base1 = ((X1 * go2) + (Y1 * go1) + Z0);
                base2 = ((X0 * go2) + (Y1 * go1) + Z0);
                c10 = CLUT[base1++] - CLUT[base2++];
                c11 = CLUT[base1++] - CLUT[base2++];
                c12 = CLUT[base1++] - CLUT[base2++];
                c13 = CLUT[base1++] - CLUT[base2];

                // X0, Y1, Z0, c0);
                base1 = ((X0 * go2) + (Y1 * go1) + Z0);
                c20 = CLUT[base1++] - c00;
                c21 = CLUT[base1++] - c01;
                c22 = CLUT[base1++] - c02;
                c23 = CLUT[base1] - c03;

                // X1, Y1, Z1,
                // X1, Y1, Z0);
                base1 = ((X1 * go2) + (Y1 * go1) + Z1);
                base2 = ((X1 * go2) + (Y1 * go1) + Z0);
                c30 = CLUT[base1++] - CLUT[base2++];
                c31 = CLUT[base1++] - CLUT[base2++];
                c32 = CLUT[base1++] - CLUT[base2++];
                c33 = CLUT[base1] - CLUT[base2];

            } else if (ry >= rz && rz >= rx) {
                // block5

                //  X1, Y1, Z1,
                //  X0, Y1, Z1);
                base1 = ((X1 * go2) + (Y1 * go1) + Z1);
                base2 = ((X0 * go2) + (Y1 * go1) + Z1);
                c10 = CLUT[base1++] - CLUT[base2++];
                c11 = CLUT[base1++] - CLUT[base2++];
                c12 = CLUT[base1++] - CLUT[base2++];
                c13 = CLUT[base1] - CLUT[base2];

                // X0, Y1, Z0, c0);
                base1 = ((X0 * go2) + (Y1 * go1) + Z0);
                c20 = CLUT[base1++] - c00;
                c21 = CLUT[base1++] - c01;
                c22 = CLUT[base1++] - c02;
                c23 = CLUT[base1] - c03;

                // X0, Y1, Z1,
                // X0, Y1, Z0);
                base1 = ((X0 * go2) + (Y1 * go1) + Z1);
                base2 = ((X0 * go2) + (Y1 * go1) + Z0);
                c30 = CLUT[base1++] - CLUT[base2++];
                c31 = CLUT[base1++] - CLUT[base2++];
                c32 = CLUT[base1++] - CLUT[base2++];
                c33 = CLUT[base1] - CLUT[base2];

            } else if (rz >= ry && ry >= rx) {
                // block6

                //   X1, Y1, Z1,
                //   X0, Y1, Z1);
                base1 = ((X1 * go2) + (Y1 * go1) + Z1);
                base2 = ((X0 * go2) + (Y1 * go1) + Z1);
                c10 = CLUT[base1++] - CLUT[base2++];
                c11 = CLUT[base1++] - CLUT[base2++];
                c12 = CLUT[base1++] - CLUT[base2++];
                c13 = CLUT[base1] - CLUT[base2];

                //  X0, Y1, Z1,
                //  X0, Y0, Z1);
                base1 = ((X0 * go2) + (Y1 * go1) + Z1);
                base2 = ((X0 * go2) + (Y0 * go1) + Z1);
                c20 = CLUT[base1++] - CLUT[base2++];
                c21 = CLUT[base1++] - CLUT[base2++];
                c22 = CLUT[base1++] - CLUT[base2++];
                c23 = CLUT[base1] - CLUT[base2];

                //X0, Y0, Z1, c0
                base1 = ((X0 * go2) + (Y0 * go1) + Z1);
                c30 = CLUT[base1++] - c00;
                c31 = CLUT[base1++] - c01;
                c32 = CLUT[base1++] - c02;
                c33 = CLUT[base1] - c03;

            } else {
                output[outputPos++] = c00 * outputScale;
                output[outputPos++] = c01 * outputScale;
                output[outputPos++] = c02 * outputScale;
                output[outputPos++] = c03 * outputScale;
                continue;
            }

            // Output should be computed as x = ROUND_FIXED_TO_INT(_cmsToFixedDomain(Rest))
            // which expands as: x = (Rest + ((Rest+0x7fff)/0xFFFF) + 0x8000)>>16
            // This can be replaced by: t = Rest+0x8001, x = (t + (t>>16))>>16
            // at the cost of being off by one at 7fff and 17ffe.
            var t;
            t = (c10 * rx) + (c20 * ry) + (c30 * rz) + 0x8001; // 24 bits
            output[outputPos++] = ((c00 * 256) + t + (t >> 16)) >> 16;

            t = (c11 * rx) + (c21 * ry) + (c31 * rz) + 0x8001; // 24 bits
            output[outputPos++] = ((c01 * 256) + t + (t >> 16)) >> 16;

            t = (c12 * rx) + (c22 * ry) + (c32 * rz) + 0x8001; // 24 bits
            output[outputPos++] = ((c02 * 256) + t + (t >> 16)) >> 16;

            t = (c13 * rx) + (c23 * ry) + (c33 * rz) + 0x8001; // 24 bits
            output[outputPos++] = ((c03 * 256) + t + (t >> 16)) >> 16;

            // output[outputPos++] = ((c00 * 256) + (c10 * rx) + (c20 * ry) + (c30 * rz)) >> 16;
        }
    };

    tetrahedralInterp3D_NCh_F16(input16, lut) {
        var rx, ry, rz;
        var X0, X1, Y0, Y1, Z0, Z1, px, py, pz, input0, input1, input2;
        var base0, base1, base2, base3, base4,
            a, b, c, o;

        var outputScale = lut.outputScale;
        var outputChannels = lut.outputChannels;
        var gridEnd = (lut.g1 - 1);
        var CLUT = lut.CLUT;
        var go0 = lut.go0;
        var go1 = lut.go1;
        var go2 = lut.go2;

        // We need some clipping here
        input0 = Math.min(Math.max(input16[0], 0), 0xFFFF);
        input1 = Math.min(Math.max(input16[1], 0), 0xFFFF);
        input2 = Math.min(Math.max(input16[2], 0), 0xFFFF);

        // only px needs to be a float
        px = input0 * gridEnd / 0xFFFF;
        py = input1 * gridEnd / 0xFFFF;
        pz = input2 * gridEnd / 0xFFFF;

        X0 = ~~px; //~~ is the same as Math.floor(px)
        rx = (px - X0); // get the fractional part
        if (X0 === gridEnd) {
            X1 = X0 *= go2;// change to index in array
        } else {
            X0 *= go2;
            X1 = X0 + go2;
        }

        Y0 = ~~py;
        ry = (py - Y0);
        if (Y0 === gridEnd) {
            Y1 = Y0 *= go1;
        } else {
            Y0 *= go1;
            Y1 = Y0 + go1;
        }

        Z0 = ~~pz;
        rz = (pz - Z0);
        if (Z0 === gridEnd) {
            Z1 = Z0 *= go0;
        } else {
            Z0 *= go0;
            Z1 = Z0 + go0;
        }

        // Starting point
        base0 = X0 + Y0 + Z0;

        var output = new Array(outputChannels);

        if (rx >= ry && ry >= rz) {
            // block1
            base1 = X1 + Y0 + Z0;
            base2 = X1 + Y1 + Z0;
            base4 = X1 + Y1 + Z1;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base1++];
                b = CLUT[base2++];
                c = CLUT[base0++];
                output[o] = (c + ((a - c) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;
            }

        } else if (rx >= rz && rz >= ry) {
            // block2

            base1 = X1 + Y0 + Z0;
            base2 = X1 + Y1 + Z1;
            base3 = X1 + Y0 + Z1;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base3++];
                b = CLUT[base1++];
                c = CLUT[base0++];
                output[o] = (c + ((b - c) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;
            }

        } else if (rx >= ry && rz >= rx) {
            // block3

            base1 = X1 + Y0 + Z1;
            base2 = X0 + Y0 + Z1;
            base3 = X1 + Y1 + Z1;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base1++];
                b = CLUT[base2++];
                c = CLUT[base0++];
                output[o] = (c + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c) * rz)) * outputScale;
            }

        } else if (ry >= rx && rx >= rz) {
            // block4

            base1 = X1 + Y1 + Z0;
            base2 = X0 + Y1 + Z0;
            base4 = X1 + Y1 + Z1;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base2++];
                b = CLUT[base1++];
                c = CLUT[base0++];
                output[o] = (c + ((b - a) * rx) + ((a - c) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;
            }

        } else if (ry >= rz && rz >= rx) {
            // block5

            base1 = X1 + Y1 + Z1;
            base2 = X0 + Y1 + Z1;
            base3 = X0 + Y1 + Z0;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base2++];
                b = CLUT[base3++];
                c = CLUT[base0++];
                output[o] = (c + ((CLUT[base1++] - a) * rx) + ((b - c) * ry) + ((a - b) * rz)) * outputScale;
            }

        } else if (rz >= ry && ry >= rx) {
            // block6

            base1 = X1 + Y1 + Z1;
            base2 = X0 + Y1 + Z1;
            base4 = X0 + Y0 + Z1;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base2++];
                b = CLUT[base4++];
                c = CLUT[base0++];
                output[o] = (c + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c) * rz)) * outputScale;
            }

        } else {
            for (let o = 0; o < outputChannels; o++) {
                output[o] = CLUT[base0++] * outputScale;
            }
        }

        return output;
    };


    //UPDATED
    tetrahedralInterp4D_3or4Ch_Master(input, lut) {
        return tetrahedralInterp4D_3or4Ch_Master(input, lut);
    }

    // todo - tetrahedralInterp5D, tetrahedralInterp6D ....
    /**
     * Generic tetrahedral 4D interpolation for 3D LUTs
     * @param input
     * @param lut
     * @returns {*}
     */
    //UPDATED
    tetrahedralInterp4D_3or4Ch(input, lut) {
        /**
         * For more than 3 inputs (i.e., CMYK)
         * evaluate two 3-dimensional interpolations and then linearly interpolate between them.
         */
        var K0, K1, inputK, pk, rk;
        inputK = pk = Math.max(0.0, Math.min(1.0, input[0] * lut.inputScale));

        pk = pk * (lut.g1 - 1);
        K0 = Math.floor(pk);
        rk = pk - K0;
        K1 = (inputK >= 1.0) ? K0 : K0 + 1;

        var cmyInput = [input[1], input[2], input[3]];

        // var output1 = this.tetrahedralInterp3D_3or4Ch(cmyInput, lut, K0);
        var output1 = tetrahedralInterp3D_3or4Ch(cmyInput, lut, K0);
        // Such a small edge case where k===n/g1 perhaps faster without checking
        if (rk === 0) {
            return output1;
        }
        // var output2 = this.tetrahedralInterp3D_3or4Ch(cmyInput, lut, K1);
        var output2 = tetrahedralInterp3D_3or4Ch(cmyInput, lut, K1);

        // interpolate two results
        // Note that tetrahedralInterp3D already applies the output scale
        output1[0] = output1[0] + ((output2[0] - output1[0]) * rk);
        output1[1] = output1[1] + ((output2[1] - output1[1]) * rk);
        output1[2] = output1[2] + ((output2[2] - output1[2]) * rk);
        if (lut.outputChannels === 3) {
            return output1;
        }
        output1[3] = output1[3] + ((output2[3] - output1[3]) * rk);
        return output1;
    };

    /**
     * @param {Profile} profile
     * @param {eIntent} intent
     */
    detectOutputBlackpoint(profile, intent) {
        var blackLab;
        var _this = this;
        var absoluteBlackXYZ = this.XYZ(0, 0, 0);

        const intentString = this.intent2String(intent);
        const profileTypeString = Object.entries(eProfileType).find(([key, value]) => value === profile.type)?.[0] || 'Unknown';

        // console.log(this.debugging);

        if (!profile) {
            if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `invalid ${intentString}`, { profile }, { absoluteBlackXYZ });
            return absoluteBlackXYZ;
        }

        // note that *lab profiles have no black point and are 'abst'
        if (profile.header.pClass === 'link' || profile.header.pClass === 'abst' || profile.header.pClass === 'nmcl') {
            if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `${profileTypeString} ${profile.header.pClass} ${intentString}`, { absoluteBlackXYZ });
            return absoluteBlackXYZ;
        }

        // check intent
        if (intent === eIntent.absolute) {
            if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `${profileTypeString} ${intentString}`, { absoluteBlackXYZ });
            return absoluteBlackXYZ;
        }

        if (profile.type === eProfileType.RGBMatrix) {
            if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `${profileTypeString} ${intentString}`, { absoluteBlackXYZ });
            return absoluteBlackXYZ;
        }

        // v4 + perceptual & saturation intents have their own defined black point, and it is
        // well specified enough to use it. Black point tag is deprecated in V4.
        if ((profile.version === 4) && (intent === eIntent.perceptual || intent === eIntent.saturation)) {

            if (profile.type === eProfileType.RGBMatrix) {
                blackLab = this.RGBDevice_to_PCSv4_or_LabD50([0, 0, 0], profile, true);

                if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `${profileTypeString} v4 ${intentString}`, { blackLab });
                return this.Lab2XYZ(blackLab);
            }

            // V4 perceptual black is predefined by the spec
            const blackXYZ = this.XYZ(0.00336, 0.0034731, 0.00287);

            if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `v4 ${intentString}`, { blackXYZ });
            return blackXYZ;
        }

        // not a LUT based profile then calc as per input
        var hasLUT = !!profile.B2A[this.intent2LUTIndex(intent)];

        var colorSpaceCanUseBPC = (
            profile.type === eProfileType.Gray ||
            profile.type === eProfileType.RGBLut ||
            profile.type === eProfileType.CMYK
        );

        // Profile must be Gray, RGB or CMYK and be lut based B2A0 tag
        if (!colorSpaceCanUseBPC || !hasLUT) {
            // Else use input case

            const blackXYZ = this.detectBlackpoint(profile, intent);

            if (this.debugging?.detectOutputBlackPoint) console.log('detectOutputBlackPoint [%s]:', `${profileTypeString} ${intentString} Without BPC`, { blackXYZ });

            return blackXYZ;
        }

        var initialLab;
        if (intent === eIntent.relative) {
            initialLab = this.XYZ2Lab(this.detectBlackpoint(profile, intent), illuminants.d50);
        } else {
            initialLab = this.Lab(0, 0, 0);
        }

        // Step 2
        // Create a round trip. Define a Transform BT for all x in L*a*b*
        // PCS -> PCS round trip transform, always uses relative intent on the device -> pcs
        var labProfile = new Profile('*Lab');
        var transformLab2Device = new Transform({ precision: 3, debugging: this.debugging });
        var transformDevice2Lab = new Transform({ precision: 3, debugging: this.debugging });

        // Disable black point compensation Auto Enable in these temp transforms
        // or else we end up in an infinite loop and run out of stack
        transformLab2Device._BPCAutoEnable = false;
        transformDevice2Lab._BPCAutoEnable = false;

        transformLab2Device.create(labProfile, profile, intent);
        transformDevice2Lab.create(profile, labProfile, eIntent.relative);

        var inRamp = [];
        var outRamp = [];
        var lab = this.Lab(0, 0, 0);
        lab.a = Math.min(50, Math.max(-50, initialLab.a));
        lab.b = Math.min(50, Math.max(-50, initialLab.b));

        // Create ramp up the flag pole
        for (var l = 0; l < 256; l++) {
            lab.L = (l * 100.0) / 255.0;
            var device = transformLab2Device.forward(lab);
            var destLab = transformDevice2Lab.forward(device);
            inRamp[l] = lab.L;
            outRamp[l] = destLab.L;
        }

        // Make monotonic, always decreasing,
        // this way we get the lowest black point
        for (let l = 254; l > 0; --l) {
            outRamp[l] = Math.min(outRamp[l], outRamp[l + 1]);
        }

        // Check
        if (!(outRamp[0] < outRamp[255])) {
            return absoluteBlackXYZ;
        }

        // Test for mid-range straight (only on relative colorimetric)
        var nearlyStraightMidrange = true;
        var minL = outRamp[0];
        var maxL = outRamp[255];
        if (intent === eIntent.relative) {
            for (let l = 0; l < 256; l++) {
                if (!((inRamp[l] <= minL + 0.2 * (maxL - minL)) || ((inRamp[l] - outRamp[l]) < 4.0))) {
                    nearlyStraightMidrange = false;
                    break;
                }
            }
            // If the mid range is straight (as determined above) then the
            // DestinationBlackPoint shall be the same as initialLab.
            // Otherwise, the DestinationBlackPoint shall be determined
            // using curve fitting.
            if (nearlyStraightMidrange) {
                return this.Lab2XYZ(initialLab);
            }
        }

        // curve fitting: The round-trip curve normally looks like a nearly constant section at the black point,
        // with a corner and a nearly straight line to the white point.
        var yRamp = [];
        var hi, lo;
        for (let l = 0; l < 256; l++) {
            yRamp[l] = (outRamp[l] - minL) / (maxL - minL);
        }

        // find the black point using the least squares error quadratic curve fitting
        if (intent === eIntent.relative) {
            lo = 0.1;
            hi = 0.5;
        }
        else {
            // Perceptual and saturation
            lo = 0.03;
            hi = 0.25;
        }

        // Capture shadow points for the fitting.
        var n = 0;
        var x = [], y = [];
        for (let l = 0; l < 256; l++) {
            var ff = yRamp[l];
            if (ff >= lo && ff < hi) {
                x[n] = inRamp[l];
                y[n] = yRamp[l];
                n++;
            }
        }

        // No suitable points
        if (n < 3) {
            return absoluteBlackXYZ;
        }

        // fit and get the vertex of quadratic curve
        lab.L = rootOfLeastSquaresFitQuadraticCurve(n, x, y);

        if (lab.L < 0.0) { // clip to zero L* if the vertex is negative OR
            lab.L = 0;
        }

        lab.a = initialLab.a;
        lab.b = initialLab.b;

        return this.Lab2XYZ(lab);

        // Least Squares Fit of a Quadratic Curve to Data
        // http://www.personal.psu.edu/jhm/f90/lectures/lsq2.html
        function rootOfLeastSquaresFitQuadraticCurve(n, x, y) {
            var sum_x = 0, sum_x2 = 0, sum_x3 = 0, sum_x4 = 0;
            var sum_y = 0, sum_yx = 0, sum_yx2 = 0;
            var d, a, b, c;
            var i;

            if (n < 4) return 0;

            for (let i = 0; i < n; i++) {
                var xn = x[i];
                var yn = y[i];

                sum_x += xn;
                sum_x2 += xn * xn;
                sum_x3 += xn * xn * xn;
                sum_x4 += xn * xn * xn * xn;

                sum_y += yn;
                sum_yx += yn * xn;
                sum_yx2 += yn * xn * xn;
            }

            /** @type {number[]} */
            var matrix = [n, sum_x, sum_x2,
                sum_x, sum_x2, sum_x3,
                sum_x2, sum_x3, sum_x4];

            var invMatrix = _this.invertMatrix(matrix);

            var res = _this.evalMatrix([sum_y, sum_yx, sum_yx2], invMatrix);
            a = res[2];
            b = res[1];
            c = res[0];

            if (a < 1.0E-10) {
                return Math.min(0, Math.max(50, -c / b));
            } else {
                d = b * b - 4.0 * a * c;
                if (d <= 0) {
                    return 0;
                }
                else {
                    var rt = (-b + Math.sqrt(d)) / (2.0 * a);
                    return Math.max(0, Math.min(50, rt));
                }
            }
        }
    };

    /**
     * @param {Profile} profile
     * @param {eIntent} intent
     */
    detectBlackpoint(profile, intent) {
        const XYZ0 = this.XYZ(0, 0, 0);

        if (!profile)
            return XYZ0;
        if (profile.header.pClass === 'link' || profile.header.pClass === 'abst' || profile.header.pClass === 'nmcl')
            return XYZ0;
        if (intent === eIntent.absolute)
            return XYZ0;
        if (profile.type === eProfileType.RGBMatrix)
            return XYZ0;

        // if (!profile) return XYZ0;
        // if (profile.header.pClass === 'link' || profile.header.pClass === 'abst' || profile.header.pClass === 'nmcl') return XYZ0;
        // if (intent === eIntent.absolute) return XYZ0; // check intent
        // if (profile.type === eProfileType.RGBMatrix) return XYZ0;

        // v4 + perceptual & saturation intents does have its own black point, and it is
        // well specified enough to use it. Black point tag is deprecated in V4.
        if (profile.version === 4 && (intent === eIntent.perceptual || intent === eIntent.saturation)) {

            if (profile.type === eProfileType.RGBMatrix)
                return this.Lab2XYZ(this.RGBDevice_to_PCSv4_or_LabD50([0, 0, 0], profile, true));

            // V4 perceptual black is predefined by the spec
            return this.XYZ(0.00336, 0.0034731, 0.00287);
        }

        // v2 profile, we need to find the blackpoint
        // calculate blackpoint using perceptual black
        if (profile.header.pClass === 'prtr' && profile.type === eProfileType.CMYK && intent === eIntent.relative)
            return this.Lab2XYZ(this.findInkLimitedBlackpoint(profile));

        return this.Lab2XYZ(this.findMaxColourantBlackpoint(profile, intent));

    };

    findMaxColourantBlackpoint(profile, intent) {
        var deviceWhite, deviceBlack;

        switch (profile.type) {
            case eProfileType.Gray:
                deviceWhite = convert.Gray(100);
                deviceBlack = convert.Gray(0);
                break;
            case eProfileType.Duo:
                // throw new Error('Duo profiles not supported by Black Point Compensation');
                deviceWhite = convert.Duo(100, 100);
                deviceBlack = convert.Duo(0, 0);
                break;
            case eProfileType.RGBLut:
                deviceWhite = convert.RGB(255, 255, 255);
                deviceBlack = convert.RGB(0, 0, 0);
                break;
            case eProfileType.CMYK:
                deviceWhite = convert.CMYK(0, 0, 0, 0);
                deviceBlack = convert.CMYK(100, 100, 100, 100);
                break;
            case eProfileType.Lab:
                throw new Error('Lab profiles not supported by Black Point Compensation');
            default:
                throw new Error(profile.type + ' not supported by Black Point Compensation');
        }

        var labD50 = new Profile('*Lab');
        var transformDevice2Lab = new Transform({ precision: 3, debugging: this.debugging });

        // Disable auto BPC in these temp transforms
        transformDevice2Lab._BPCAutoEnable = false;

        transformDevice2Lab.create(profile, labD50, intent);
        var blackLab = transformDevice2Lab.forward(deviceBlack);
        var whiteLab = transformDevice2Lab.forward(deviceWhite);

        if (whiteLab.L < blackLab.L) {
            // Just in case of inversion in number??
            blackLab = whiteLab;
        }

        blackLab.a = 0;
        blackLab.b = 0;
        if (blackLab.L > 50 || blackLab.L < 0) {
            blackLab.L = 0;
        }

        return blackLab;
    };

    findInkLimitedBlackpoint(profile) {
        /*CMYK devices are  usually ink-limited. For CMYK and multi-ink spaces, a roundtrip
        L*a*b*  Colorant  L*a*b* must be used. The first   conversion L*a*b*  Colorant computes the colorant
        associated to L*a*b* value of (0, 0, 0) by the perceptual intent.
        This returns the darkest ink-limited colorant combination as
        know by the profile. The next step is to get the real L*a*b* of
        this colorant, and this can be obtained by the Colorant L*a*b*
        conversion by using the relative colorimetric intent, which
        corresponds to the BToA1 tag. This effectively takes care of any
        ink-limit embedded in the profile. CMYK profiles used as input
        can use this method.*/

        var labD50 = new Profile('*Lab');

        var transformLab2Device = new Transform({ precision: 3, debugging: this.debugging });
        var transformDevice2Lab = new Transform({ precision: 3, debugging: this.debugging });

        // Disable auto BPC in these temp transforms
        transformDevice2Lab._BPCAutoEnable = false;
        transformDevice2Lab._BPCAutoEnable = false;

        //TODO change a multistep transform
        transformLab2Device.create(labD50, profile, eIntent.perceptual);
        transformDevice2Lab.create(profile, labD50, eIntent.relative);

        var device = transformLab2Device.forward(this.Lab(0, 0, 0));
        var blackLab = transformDevice2Lab.forward(device);

        if (blackLab.L > 50) {
            blackLab.L = 50;
        }
        blackLab.a = blackLab.b = 0;

        return blackLab;
    };

}

////////////////////////////////////////////////////////////////////////////////
//
//  Helpers
//

function data2String(color, format, precision) {
    if (typeof precision === 'undefined') {
        precision = 6;
    }

    if (color === null) {
        return '<NULL>';
    }

    if (color.type) {
        return convert.cmsColor2String(color);
    }

    if (color.hasOwnProperty('L')) { // labD50 object {L:0, a:0, b:0}
        return 'LabD50: ' + n2str(color.L, precision) + ', ' + n2str(color.a, precision) + ', ' + n2str(color.b, precision);
    }

    var str = '';
    for (var i = 0; i < color.length; i++) {
        switch (format) {
            case 'r':
            case 'round':
                str += Math.round(color[i]);
                break;
            case 'f>16':
            case 'float>16':
                str += Math.round(color[i] * 65535);
                break;
            case 'float':
            case 'f':
            default:
                // raw
                str += n2str(color[i], precision);
        }
        if (i < color.length - 1) {
            str += ', ';
        }
    }
    return str;

    function n2str(n, precision) {
        return isNaN(n) ? n : n.toFixed(precision);
    }
}

// Export utility functions for legacy LUT support
export { uint16ArrayToBase64, uint8ArrayToBase64, base64ToUint16Array, base64ToUint8Array };

/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsLab : Transform[k]}} Lab2LabTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsCMYK : Transform[k]}} Lab2CMYKTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsRGB : Transform[k]}} Lab2RGBTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsGray : Transform[k]}} Lab2GrayTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsCMYK: import('./def.js')._cmsCMYK) => import('./def.js')._cmsLab : Transform[k]}} CMYK2LabTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsRGB: import('./def.js')._cmsRGB) => import('./def.js')._cmsLab : Transform[k]}} RGB2LabTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsRGB: import('./def.js')._cmsGray) => import('./def.js')._cmsLab : Transform[k]}} Gray2LabTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsRGB) => import('./def.js')._cmsCMYK : Transform[k]}} RGB2CMYKTransform */
/** @typedef {{ [k in keyof Transform]: k extends 'forward' ? (cmsCMYK: import('./def.js')._cmsCMYK) => import('./def.js')._cmsRGB : Transform[k]}} CMYK2RGBTransform */
