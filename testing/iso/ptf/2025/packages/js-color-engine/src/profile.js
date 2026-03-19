/**
 * @fileoverview ICC Color Profile loading and management
 * Handles loading ICC profiles from various sources including files, URLs, base64 data, and virtual profiles
 * 
 * @license GPL-3.0-or-later
 * @copyright 2019, 2024 Glenn Wilton, O2 Creative Limited
 */

// @ts-check

import convert from './convert.js';
import { eIntent, eProfileType, base64ToUint8Array } from './def.js';
import * as decode from './decode.js';

// const eIntent = colorEngineDef.eIntent;
// const eProfileType = colorEngineDef.eProfileType;

/**
 * @typedef {'*sRGB' | '*AdobeRGB' | '*AppleRGB' | '*ColorMatchRGB' | '*ProPhotoRGB' | '*Lab' | '*LabD50' | '*LabD65'} ProfileNames
 */

/**
 * @template {`*${string}`} [T = ProfileNames | Uppercase<ProfileNames> | Lowercase<ProfileNames>] 
 * @typedef {Lowercase<T> extends Lowercase<ProfileNames> ? T : never} NamedProfile
 */

/**
 * ICC Color Profile class for loading and managing color profiles
 * Supports loading from multiple sources: binary data, files, URLs, base64, and virtual profiles
 * 
 * Virtual profiles supported:
 * - '*sRGB' - sRGB color space
 * - '*AdobeRGB' - Adobe RGB (1998) 
 * - '*AppleRGB' - Apple RGB
 * - '*ColorMatchRGB' - ColorMatch RGB
 * - '*ProPhotoRGB' - ProPhoto RGB
 * - '*Lab' - Lab D50
 * - '*LabD50' - Lab D50
 * - '*LabD65' - Lab D65
 * 
 * Features:
 * 1. Decodes ICC Profile from binary Uint8Array, URL, or base64 encoded string
 * 2. Creates virtual profiles in memory for common color spaces
 * 3. Supports ICC Profile version 2 and 4
 * 4. Supports RGB, Gray, Lab and CMYK profiles
 * 5. RGB Profiles can be Matrix based or LUT based
 */
export class Profile {

    /**
     * Creates a new Profile instance and optionally loads data
     * @param {NamedProfile|Uint8Array} [dataOrUrl] - Data source to load from:
     *   - Uint8Array: binary ICC profile data
     *   - String starting with '*': virtual profile name
     *   - String starting with 'file:': local file path
     *   - String starting with 'data:': base64 encoded data
     *   - String (other): HTTP URL
     * @param {Function} [afterLoad] - Callback function(profile) executed after loading
     */
    constructor(dataOrUrl, afterLoad) {
        /** Profile loading state - true when profile is successfully loaded */
        this.loaded = false;

        /** Profile loading error state - true when an error occurred during loading */
        this.loadError = false;

        /** Profile type from eProfileType enum */
        this.type = 0;

        /** Profile name extracted from ICC profile data */
        this.name = '';

        /** ICC profile header information */
        this.header = {};

        /** Default rendering intent for this profile */
        this.intent = 0;

        /** Array of ICC profile tags */
        this.tags = [];

        /** Profile description text */
        this.description = '';

        /** Tag description information */
        this.tagDescription = '';

        /** Copyright information */
        this.copyright = '';

        /** Technology information */
        this.technology = '';

        /** 
         * Viewing conditions description.
         * @type {ReturnType<decode['viewingConditions'] | decode['text']> | ''}
         */
        this.viewingConditions = '';

        /** 
         * Characterization target information 
         * @type {ReturnType<decode['text']> | ''}
         */
        this.characterizationTarget = '';

        /** 
         * Media white point in XYZ coordinates 
         * @type {import('./def.js')._cmsWhitePoint?}
         */
        this.mediaWhitePoint = null;

        /** PCS encoding type for encoding operations */
        this.PCSEncode = 2;

        /** PCS decoding type for decoding operations */
        this.PCSDecode = 2;

        /** 8-bit PCS scaling factor */
        this.PCS8BitScale = 0;

        /** ICC profile version */
        this.version = 0;

        /** Whether this uses Profile Connection Space */
        /** @type {'LAB'|'XYZ'|false} */
        this.pcs = false;

        /** 
         * Black point in XYZ coordinates 
         * @type {import('./def.js')._cmsXYZ?} 
         */
        this.blackPoint = null;

        /** 
         * White point in XYZ coordinates
         * @type {import('./def.js')._cmsWhitePoint?}
         */
        this.whitePoint = null;

        /** Luminance information */
        this.luminance = null;

        /** Chromatic adaptation matrix */
        this.chromaticAdaptation = null;

        /** Whether virtual profile uses D50 adapted primaries */
        this.virutalProfileUsesD50AdaptedPrimaries = true;

        /** Array of unsupported ICC tags */
        this.unsuportedTags = [];

        /** Grayscale profile data */
        this.Gray = {
            /** 
             * Grayscale tone reproduction curve
             * @type {ReturnType<decode.curve>?}
             */

            kTRC: null,

            /** 
             * Inverse grayscale tone reproduction curve 
             * @type {ReturnType<decode.curve>?}
             */
            inv_kTRC: null,
        };

        /** RGB profile data */
        this.rgb = {
            /**
             * Red tone reproduction curve
             * @type {ReturnType<decode.curve>?}
             */
            rTRC: null,
            /** 
             * Inverse red tone reproduction curve 
             * @type {ReturnType<decode.curve>?}
             */
            rTRCInv: null,
            /** 
             * Green tone reproduction curve 
             * @type {ReturnType<decode.curve>?}
             */
            gTRC: null,
            /** 
             * Inverse green tone reproduction curve 
             * @type {ReturnType<decode.curve>?}
             */
            gTRCInv: null,
            /** 
             * Blue tone reproduction curve 
             * @type {ReturnType<decode.curve>?}
             */
            bTRC: null,
            /** 
             * Inverse blue tone reproduction curve 
             * @type {ReturnType<decode.curve>?}
             */
            bTRCInv: null,

            /** Red colorant XYZ values */
            rXYZ: null,
            /** Green colorant XYZ values */
            gXYZ: null,
            /** Blue colorant XYZ values */
            bXYZ: null
        };

        /** RGB matrix profile data @type {import('./convert.js').RGBMatrix} */
        this.RGBMatrix = {
            /** Gamma value for matrix profiles */
            gamma: 0,
            /** Red colorant x chromaticity */
            cRx: 0,
            /** Red colorant y chromaticity */
            cRy: 0,
            /** Green colorant x chromaticity */
            cGx: 0,
            /** Green colorant y chromaticity */
            cGy: 0,
            /** Blue colorant x chromaticity */
            cBx: 0,
            /** Blue colorant y chromaticity */
            cBy: 0
        };

        /** Profile Connection Space white point (default D50) @type {import('./def.js')._cmsWhitePoint} */
        this.PCSWhitepoint = convert.d50;

        /** Number of output channels in the profile */
        this.outputChannels = 0;

        /** Last error information */
        this.lastError = { err: 0, text: 'No Error' };

        /** 
         * Floating-point LUT tables (B to device) - not implemented yet 
         * @type {[Partial<decode.LUT>?, Partial<decode.LUT>?, Partial<decode.LUT>?, Partial<decode.LUT>?]}
         */
        this.B2D = [null, null, null, null];

        /** 
         * Floating-point LUT tables (device to B) - not implemented yet 
         * @type {[Partial<decode.LUT>?, Partial<decode.LUT>?, Partial<decode.LUT>?, Partial<decode.LUT>?]}
         */
        this.D2B = [null, null, null, null];

        /** 
         * A2B (AToB) lookup tables for device to PCS conversion 
         * @type {[Partial<decode.LUT>?, Partial<decode.LUT>?, Partial<decode.LUT>?]}
         */
        this.A2B = [null, null, null];

        /** 
         * B2A (BToA) lookup tables for PCS to device conversion 
         * @type {[Partial<decode.LUT>?, Partial<decode.LUT>?, Partial<decode.LUT>?]}
         */
        this.B2A = [null, null, null];

        /** Absolute colorimetric adaptation factors for input */
        this.absoluteAdaptationIn = {
            Xa: 1,
            Ya: 1,
            Za: 1
        };

        /** Absolute colorimetric adaptation factors for output */
        this.absoluteAdaptationOut = {
            Xa: 1,
            Ya: 1,
            Za: 1
        };

        if (dataOrUrl) {
            this.load(dataOrUrl, afterLoad);
        }
    };

    /**
     * Loads profile data asynchronously and returns a Promise
     * @param {string|Uint8Array} dataOrUrl - Data source to load from
     * @returns {Promise<Profile>} Promise that resolves with the loaded profile
     */
    loadPromise(dataOrUrl) {
        return new Promise((resolve, reject) => {
            this.load(dataOrUrl, (loaded) => {
                if (loaded) {
                    resolve(loaded);
                } else {
                    reject(new Error("Profile failed to load"));
                }
            });
        });
    }

    /**
     * Generic profile loader that detects data type and calls appropriate loader
     * @param {string|Uint8Array} dataOrUrl - Data source:
     *   - Uint8Array: binary ICC profile data
     *   - String starting with '*': virtual profile name
     *   - String starting with 'file:': local file path
     *   - String starting with 'data:': base64 encoded data
     *   - String (other): HTTP URL
     * @param {Function} [afterLoad] - Callback function(profile) executed after loading
     */
    load(dataOrUrl, afterLoad) {
        this.loaded = false;
        this.loadError = false;
        if (dataOrUrl instanceof Uint8Array) {
            this.loadBinary(dataOrUrl, afterLoad);
        } else if (
            // `${dataOrUrl}`.substring(0, 1) === '*'
            /^\*/.test(dataOrUrl)
        ) {
            this.loadVirtualProfile(dataOrUrl, afterLoad);
        } else if (
            // `${dataOrUrl}`.substring(0, 5).toLowerCase() === 'file:'
            /^file:/i.test(dataOrUrl)
        ) {
            this.loadFile(dataOrUrl, afterLoad);
        } else if (
            // `${dataOrUrl}`.substring(0, 5).toLowerCase() === 'data:'
            /^data:/i.test(dataOrUrl)
        ) {
            this.loadBase64(dataOrUrl, afterLoad);
        } else {
            this.loadURL(dataOrUrl, afterLoad);
        }
    };

    /**
     * Loads ICC profile from binary data (Uint8Array)
     * @param {Uint8Array} binary - Binary ICC profile data
     * @param {Function} [afterLoad] - Callback function executed after loading
     * @param {boolean} [searchForProfile=true] - Whether to search for embedded profiles
     */
    loadBinary(binary, afterLoad, searchForProfile) {
        this.loaded = this.readICCProfile(binary, searchForProfile);
        this.loadError = !this.loaded;

        // if (typeof afterLoad === 'function') afterLoad(this);
        afterLoad?.(this);
    };

    /**
     * Loads ICC profile from a local file (Node.js only)
     * @param {string} filename - File path, optionally prefixed with 'file:'
     * @param {Function} [afterLoad] - Callback function executed after loading
     * @returns {Promise<void>} Promise that resolves when loading completes
     */
    async loadFile(filename, afterLoad) {

        // if (filenameString.substring(0, 5).toLowerCase() === 'file:')  filename = filenameString.substring(5, filenameString.length);

        // const filenameString = /^file:/i.test(filename) ? `${filename}`.slice(5) : `${filename}`;
        const filenameString = `${filename ?? ''}`;

        // console.log('loadFile', { filename, filenameString });

        const binaryData = await this.readBinaryFile(filenameString);

        if (binaryData !== false) {
            this.loaded = this.readICCProfile(binaryData);
            this.loadError = !this.loaded;
        } else {
            this.loadError = true;
            this.loaded = false;
        }

        // if (typeof afterLoad === 'function') afterLoad(this);
        afterLoad?.(this);
    };

    /**
     * Loads ICC profile from base64 encoded data
     * @param {string} base64 - Base64 encoded ICC profile data, optionally prefixed with 'data:'
     * @param {Function} [afterLoad] - Callback function executed after loading
     */
    loadBase64(base64, afterLoad) {

        // if (base64.substring(0, 5).toLowerCase() === 'data:') base64 = base64.substring(5, base64.length);

        const base64String = /^data:/i.test(base64) ? `${base64}`.slice(5) : `${base64}`;
        const data = base64ToUint8Array(base64String);

        this.loaded = this.readICCProfile(data);
        this.loadError = !this.loaded;

        // if (typeof afterLoad === 'function') afterLoad(this);
        afterLoad?.(this);
    };

    async loadURL(url, afterLoad) {
        const processData = (result, errorString) => {
            this.lastError = { err: !errorString ? 0 : -1, text: errorString };
            if (result) {
                this.loaded = this.readICCProfile(result);
                this.loadError = !this.loaded;
            } else {
                this.loaded = false;
                this.loadError = true;
            }

            // if (typeof afterLoad === 'function') afterLoad(this);
            afterLoad?.(this);
        };

        if (isInNode()) {
            await nodeLoadFileFromURL(url, processData);
        } else {
            XHRLoadBinary(url, processData);
        }
    };

    loadVirtualProfile(name, afterLoad) {
        // if (name.substring(0, 1) === '*') name = name.substring(1, name.length);

        const nameString = /^\*/i.test(name) ? `${name}`.slice(1) : `${name}`;

        this.loaded = this.createVirtualProfile(nameString);
        this.loadError = !this.loaded;

        // if (typeof afterLoad === 'function') afterLoad(this);
        afterLoad?.(this);
    };

    async readBinaryFile(specifier) {
        // let b64String;
        if (isInCep()) {
            /**
             * @type {object}
             * @property {import('fs')} fs - The file system object
             * @property {string} encoding - The encoding type
             */
            const cep = globalThis.cep;

            if (cep && cep.fs && cep.fs.readFile) {
                // In adobe illustrator cep enviroment
                const filename = /^file:\/*/i[Symbol.replace](specifier, '');

                const file = cep.fs.readFile(filename, cep.encoding.Base64);

                if (file.err === 0) {
                    // b64String = file.data;
                    return file.data;
                } else {
                    this.lastError = {
                        err: file.err,
                        text: file.errorString = [
                            'NO_ERROR', //0
                            'ERR_UNKNOWN', //1
                            'ERR_INVALID_PARAMS', //2
                            'ERR_NOT_FOUND', //3
                            'ERR_CANT_READ', // 4
                            'ERR_UNSUPPORTED_ENCODING', // 5
                            'ERR_CANT_WRITE', // 6
                            'ERR_OUT_OF_SPACE', // 7
                            'ERR_NOT_FILE', // 8
                            'ERR_NOT_DIRECTORY', // 9
                            'ERR_FILE_EXISTS', // 10
                            'UNABLE TO PARSE FILE', //11,
                            'ERR_DIRECTORY_NOT_FOUND' //12
                        ][file.err] || 'UNKNOWN ERROR ' + file.err
                    };
                    return false;
                }
            }
        }


        if (isInNode()) {
            //
            // In node, we can use the Buffer class
            //
            const fs = await import("fs");
            const { fileURLToPath } = await import('url');

            const filename = /^file:/i.test(specifier) ? fileURLToPath(specifier) : `${specifier ?? ''}` || undefined;

            // console.log('readBinaryFile: isInNode ', { specifier, filename });

            try {
                return base64ToUint8Array(
                    // @ts-ignore
                    fs.readFileSync(filename, { encoding: 'base64' })
                );
            } catch (e) {
                // console.error(e);
                this.lastError = { err: e, text: e.message };
                return false;
            }
            // return base64ToUint8Array(b64String);
        }

        // Not supported in browser
        throw new Error('readBinaryFile not supported in this environment');
    }

    createVirtualProfile(name) {

        // Virtual Profiles are this.version = v4 so that by default the Transform will output PCS V4 encoded date
        // http://www.brucelindbloom.com/index.html?WorkingSpaceInfo.html
        //
        //                  gamma   white   x           y           Y           x           y           Y           x           y           Y
        // Adobe RGB (1998)	2.2	    D65     0.6400      0.3300      0.297361    0.2100      0.7100      0.627355    0.1500      0.0600      0.075285
        // Apple RGB        1.8     D65     0.6250      0.3400      0.244634    0.2800      0.5950      0.672034    0.1550      0.0700      0.083332
        // Best RGB         2.2     D50     0.7347      0.2653      0.228457    0.2150      0.7750      0.737352    0.1300      0.0350      0.034191
        // Beta RGB         2.2     D50     0.6888      0.3112      0.303273    0.1986      0.7551      0.663786    0.1265      0.0352      0.032941
        // Bruce RGB        2.2     D65     0.6400      0.3300      0.240995    0.2800      0.6500      0.683554    0.1500      0.0600      0.075452
        // CIE RGB          2.2     E       0.7350      0.2650      0.176204    0.2740      0.7170      0.812985    0.1670      0.0090      0.010811
        // ColorMatch RGB   1.8     D50     0.6300      0.3400      0.274884    0.2950      0.6050      0.658132    0.1500      0.0750      0.066985
        // Don RGB 4        2.2     D50     0.6960      0.3000      0.278350    0.2150      0.7650      0.687970    0.1300      0.0350      0.033680
        // ECI RGB v2       L*      D50     0.6700      0.3300      0.320250    0.2100      0.7100      0.602071    0.1400      0.0800      0.077679
        // Ekta Space PS5   2.2     D50     0.6950      0.3050      0.260629    0.2600      0.7000      0.734946    0.1100      0.0050      0.004425
        // NTSC RGB         2.2     C       0.6700      0.3300      0.298839    0.2100      0.7100      0.586811    0.1400      0.0800      0.114350
        // PAL/SECAM RGB    2.2     D65     0.6400      0.3300      0.222021    0.2900      0.6000      0.706645    0.1500      0.0600      0.071334
        // ProPhoto RGB     1.8     D50     0.7347      0.2653      0.288040    0.1596      0.8404      0.711874    0.0366      0.0001      0.000086
        // SMPTE-C RGB      2.2     D65     0.6300      0.3400      0.212395    0.3100      0.5950      0.701049    0.1550      0.0700      0.086556
        // sRGB             ≈2.2    D65     0.6400      0.3300      0.212656    0.3000      0.6000      0.715158    0.1500      0.0600      0.072186
        // Wide Gamut RGB   2.2     D50     0.7350      0.2650      0.258187    0.1150      0.8260      0.724938    0.1570      0.0180      0.016875

        //Working Space Primaries Adapted to D50
        //                      x           y           Y           x           y           Y           x           y           Y
        // Adobe RGB (1998)	    0.648431	0.330856	0.311114	0.230154	0.701572	0.625662	0.155886	0.066044	0.063224
        // Apple RGB	        0.634756	0.340596	0.255166	0.301775	0.597511	0.672578	0.162897	0.079001	0.072256
        // Best RGB	            0.734700	0.265300	0.228457	0.215000	0.775000	0.737352	0.130000	0.035000	0.034191
        // Beta RGB	            0.688800	0.311200	0.303273	0.198600	0.755100	0.663786	0.126500	0.035200	0.032941
        // Bruce RGB	        0.648431	0.330856	0.252141	0.300115	0.640960	0.684495	0.155886	0.066044	0.063364
        // CIE RGB	            0.737385	0.264518	0.174658	0.266802	0.718404	0.824754	0.174329	0.000599	0.000588
        // ColorMatch RGB	    0.630000	0.340000	0.274884	0.295000	0.605000	0.658132	0.150000	0.075000	0.066985
        // Don RGB 4	        0.696000	0.300000	0.278350	0.215000	0.765000	0.687970	0.130000	0.035000	0.033680
        // ECI RGB v2	        0.670000	0.330000	0.320250	0.210000	0.710000	0.602071	0.140000	0.080000	0.077679
        // Ekta Space PS5	    0.695000	0.305000	0.260629	0.260000	0.700000	0.734946	0.110000	0.005000	0.004425
        // NTSC RGB	            0.671910	0.329340	0.310889	0.222591	0.710647	0.591737	0.142783	0.096145	0.097374
        // PAL/SECAM RGB	    0.648431	0.330856	0.232289	0.311424	0.599693	0.707805	0.155886	0.066044	0.059906
        // ProPhoto RGB	        0.734700	0.265300	0.288040	0.159600	0.840400	0.711874	0.036600	0.000100	0.000086
        // SMPTE-C RGB	        0.638852	0.340194	0.221685	0.331007	0.592082	0.703264	0.162897	0.079001	0.075052
        // sRGB	                0.648431	0.330856	0.222491	0.321152	0.597871	0.716888	0.155886	0.066044	0.060621
        // Wide Gamut RGB	    0.735000	0.265000	0.258187	0.115000	0.826000	0.724938	0.157000	0.018000	0.016875

        // https://infoscience.epfl.ch/record/34089/files/SusstrunkBS99.pdf?version=3
        // http://www.babelcolor.com/index_htm_files/A%20review%20of%20RGB%20color%20spaces.pdf

        var redxxY, greenxyY, bluexyY, mediaWhitePoint;

        // Set for RGB, Will change if we are a Lab profile
        this.outputChannels = 3;
        this.version = 4;
        this.pcs = 'XYZ';
        this.colorSpace = 'RGB';
        this.header = {
            profileSize: 0,
            cmmType: 0,
            version: 4,
            pClass: 'mntr',
            space: 'rgb',
            pcs: 'XYZ',
            date: new Date(),
            signature: '',
            platform: '',
            flags: 0,
            attributes: 0,
            intent: 3,
            PCSilluminant: convert.d50
        };

        switch (String(name).replace(' ', '').toLowerCase()) {
            case 'labd50': // LabD50
            case 'lab': // LabD50
                this.type = eProfileType.Lab;
                this.name = this.description = 'Lab D50 Profile';
                this.PCSWhitepoint = convert.d50;
                this.mediaWhitePoint = convert.d50;
                this.pcs = 'LAB';
                this.colorSpace = 'LAB';
                this.header = {
                    profileSize: 0,
                    cmmType: 0,
                    version: 4,
                    pClass: 'abst',
                    space: 'Lab',
                    pcs: 'LAB',
                    date: new Date(),
                    signature: '',
                    platform: '',
                    flags: 0,
                    attributes: 0,
                    intent: 3,
                    PCSilluminant: convert.d50
                };
                return true;

            case 'labd65': // LabD50
                this.type = eProfileType.Lab;
                this.name = this.description = 'Lab D65 Profile';
                this.PCSWhitepoint = convert.d50;
                this.mediaWhitePoint = convert.d65;
                this.pcs = 'LAB';
                this.colorSpace = 'LAB';
                this.header = {
                    profileSize: 0,
                    cmmType: 0,
                    version: 4,
                    pClass: 'abst',
                    space: 'Lab',
                    pcs: 'LAB',
                    date: new Date(),
                    signature: '',
                    platform: '',
                    flags: 0,
                    attributes: 0,
                    intent: 3,
                    PCSilluminant: convert.d50
                };
                return true;

            case 'srgb':

                if (this.virutalProfileUsesD50AdaptedPrimaries) {
                    redxxY = convert.xyY(0.648431, 0.330856, 0.222491);
                    greenxyY = convert.xyY(0.321152, 0.597871, 0.716888);
                    bluexyY = convert.xyY(0.155886, 0.066044, 0.060621);
                    mediaWhitePoint = convert.d50;
                } else {
                    redxxY = convert.xyY(0.64, 0.33, 0.212656);
                    greenxyY = convert.xyY(0.30, 0.60, 0.715158);
                    bluexyY = convert.xyY(0.15, 0.06, 0.072186);
                    mediaWhitePoint = convert.d65;
                }

                this.name = 'sRGB';
                this.description = "RGB is a standard RGB color space created cooperatively by HP and Microsoft in 1996 for use on monitors, printers and the Internet<br><br>Note that sRGB's small Gamut is not suitable for graphic production.<br><br>Encompasses roughly 35% of the visible colors specified by the Lab color space";
                this.mediaWhitePoint = mediaWhitePoint;
                computeRGBProfile(this, 2.2, redxxY, greenxyY, bluexyY, true);

                return true;

            case 'adobe1998':
            case 'adobe':
            case 'adobergb':
            case 'adobe1998rgb':
                if (this.virutalProfileUsesD50AdaptedPrimaries) {
                    redxxY = convert.xyY(0.648431, 0.330856, 0.311114);
                    greenxyY = convert.xyY(0.230154, 0.701572, 0.625662);
                    bluexyY = convert.xyY(0.155886, 0.066044, 0.063224);
                    mediaWhitePoint = convert.d50;
                } else {
                    redxxY = convert.xyY(0.64, 0.33, 0.297361);
                    greenxyY = convert.xyY(0.21, 0.71, 0.627355);
                    bluexyY = convert.xyY(0.15, 0.06, 0.075285);
                    mediaWhitePoint = convert.d65;
                }
                this.name = 'Adobe RGB (1998)';
                this.description = 'Developed by Adobe Systems, Inc. in 1998. It was designed to encompass most of the colors achievable on CMYK color printers, but by using RGB primary colors on a device such as a computer display. The Adobe RGB (1998) improves upon the gamut of the sRGB color space, primarily in cyan-green hues<br>Encompasses roughly 50% of the visible colors specified by the Lab color space';
                this.mediaWhitePoint = mediaWhitePoint;
                computeRGBProfile(this, 2.2, redxxY, greenxyY, bluexyY, false);
                return true;

            case 'apple':
            case 'applergb':
                if (this.virutalProfileUsesD50AdaptedPrimaries) {
                    redxxY = convert.xyY(0.634756, 0.340596, 0.255166);
                    greenxyY = convert.xyY(0.301775, 0.597511, 0.672578);
                    bluexyY = convert.xyY(0.162897, 0.079001, 0.072256);
                    mediaWhitePoint = convert.d50;
                } else {
                    redxxY = convert.xyY(0.6250, 0.3400, 0.244634);
                    greenxyY = convert.xyY(0.2800, 0.5950, 0.672034);
                    bluexyY = convert.xyY(0.1550, 0.0700, 0.083332);
                    mediaWhitePoint = convert.d65;
                }

                this.name = 'Apple RGB';
                this.description = 'Apple RGB is based on the classic Apple 13" RGB monitor. Because of its popularity and similar Trinitronbased monitors that followed, many key publishing applications, including Adobe Photoshop and Illustrator, used it as the default RGB space in the past.<br>Encompasses roughly 33.5% of the visible colors specified by the Lab color space';
                this.mediaWhitePoint = mediaWhitePoint;
                computeRGBProfile(this, 2.2, redxxY, greenxyY, bluexyY, false);
                return true;

            case 'colormatchrgb':
            case 'colormatch':

                // Colormatch is D50
                redxxY = convert.xyY(0.6300, 0.3400, 0.274884);
                greenxyY = convert.xyY(0.2950, 0.6050, 0.658132);
                bluexyY = convert.xyY(0.1500, 0.0750, 0.066985);

                this.name = 'ColorMatch RGB';
                this.description = 'An RGB profile with a D50 whitepoint used for prepress<br>Encompasses roughly 35.2% of the visible colors specified by the Lab color space';
                this.mediaWhitePoint = convert.d50;
                computeRGBProfile(this, 1.8, redxxY, greenxyY, bluexyY, false);
                return true;

            case 'prophoto':
            case 'prophotorgb':

                redxxY = convert.xyY(0.7347, 0.2653, 0.288040);
                greenxyY = convert.xyY(0.1596, 0.8404, 0.711874);
                bluexyY = convert.xyY(0.0366, 0.0001, 0.000086);

                this.name = 'ProPhoto RGB';
                this.description = 'The ProPhoto RGB color space, also known as ROMM RGB (Reference Output Medium Metric), is an output referred RGB color space developed by Kodak. It offers an especially large gamut designed for use with photographic output in mind.<br>Encompasses roughly 91.2% of the visible colors specified by the Lab color space';
                this.mediaWhitePoint = convert.d50;
                computeRGBProfile(this, 1.8, redxxY, greenxyY, bluexyY, false);
                return true;

            default:
                this.lastError = { err: 100, text: 'Unsupported Virtual Profile [' + name + ']' };
                return false;
        }

        function computeRGBProfile(profile, gamma, redxxY, greenxyY, bluexyY, isSRGB) {

            profile.type = eProfileType.RGBMatrix;

            profile.PCSWhitepoint = convert.d50;

            profile.rgb.rXYZ = convert.xyY2XYZ(redxxY);
            profile.rgb.gXYZ = convert.xyY2XYZ(greenxyY);
            profile.rgb.bXYZ = convert.xyY2XYZ(bluexyY);

            profile.RGBMatrix = {
                gamma: gamma,
                issRGB: isSRGB === true, // uses special sRGB Gamma formula
                cRx: redxxY.x,
                cRy: redxxY.y,
                cGx: greenxyY.x,
                cGy: greenxyY.y,
                cBx: bluexyY.x,
                cBy: bluexyY.y,
            };

            //
            // TODO remove this code and just use XYZMatrix
            //
            // Note, these compute the XYZ <> RGB Matrix
            // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
            //

            var m = {
                m00: profile.RGBMatrix.cRx / profile.RGBMatrix.cRy,
                m01: profile.RGBMatrix.cGx / profile.RGBMatrix.cGy,
                m02: profile.RGBMatrix.cBx / profile.RGBMatrix.cBy,

                m10: 1.0,
                m11: 1.0,
                m12: 1.0,

                m20: (1.0 - profile.RGBMatrix.cRx - profile.RGBMatrix.cRy) / profile.RGBMatrix.cRy,
                m21: (1.0 - profile.RGBMatrix.cGx - profile.RGBMatrix.cGy) / profile.RGBMatrix.cGy,
                m22: (1.0 - profile.RGBMatrix.cBx - profile.RGBMatrix.cBy) / profile.RGBMatrix.cBy
            };

            var mi = convert.invertMatrix(m);

            // Y = 1
            // var sr = whitePoint.X * mi.m00 + whitePoint.Y * mi.m01 + whitePoint.Z * mi.m02;
            var sR = (profile.mediaWhitePoint.X * mi.m00) + (profile.mediaWhitePoint.Y * mi.m01) + (profile.mediaWhitePoint.Z * mi.m02);
            var sG = (profile.mediaWhitePoint.X * mi.m10) + (profile.mediaWhitePoint.Y * mi.m11) + (profile.mediaWhitePoint.Z * mi.m12);
            var sB = (profile.mediaWhitePoint.X * mi.m20) + (profile.mediaWhitePoint.Y * mi.m21) + (profile.mediaWhitePoint.Z * mi.m22);

            // Matrix from primaries - (Needed for Legacy Code)
            profile.RGBMatrix.matrixV4 = {
                m00: sR * m.m00, m01: sG * m.m01, m02: sB * m.m02,
                m10: sR * m.m10, m11: sG * m.m11, m12: sB * m.m12,
                m20: sR * m.m20, m21: sG * m.m21, m22: sB * m.m22
            };
            profile.RGBMatrix.matrixInv = convert.invertMatrix(profile.RGBMatrix.matrixV4);

            // Matrix from XYZ values
            // Used in Transforms
            profile.RGBMatrix.XYZMatrix = {
                m00: profile.rgb.rXYZ.X, m01: profile.rgb.gXYZ.X, m02: profile.rgb.bXYZ.X,
                m10: profile.rgb.rXYZ.Y, m11: profile.rgb.gXYZ.Y, m12: profile.rgb.bXYZ.Y,
                m20: profile.rgb.rXYZ.Z, m21: profile.rgb.gXYZ.Z, m22: profile.rgb.bXYZ.Z,
            };
            profile.RGBMatrix.XYZMatrixInv = convert.invertMatrix(profile.RGBMatrix.XYZMatrix);
        }
    };



    readICCProfile(data, searchForProfile) {

        if (isInNode()) {
            if (data instanceof Buffer) {
                data = new Uint8Array(data);
            }
        }

        var _this = this;
        var start = 0;
        if (searchForProfile) {
            //Search for text "ICC_PROFILE" in an Image
            var ICC_PROFILE = [73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69];
            start = scan(data, 0, ICC_PROFILE);
            if (start === -1) {
                return false;
            }
        }

        // Search for text "acsp" in the profile header
        var acsp = [97, 99, 115, 112];
        var ascpPos = scan(data, start, acsp);
        if (ascpPos === -1) {
            return false;
        }

        // extract the core profile data
        var result = this.decodeFile(data);

        if (result === true) {
            // update whitepoint
            this.PCSWhitepoint = convert.getWhitePointFromIlluminant(this.header.PCSilluminant);

            // this.mediaWhitePoint = convert.getWhitePointFromIlluminant(this.mediaWhitePoint);

            // pre-calculate adaptation matrixV4 values
            this.absoluteAdaptationIn = {
                Xa: this.mediaWhitePoint.X / this.header.PCSilluminant.X,
                Ya: this.mediaWhitePoint.Y / this.header.PCSilluminant.Y,
                Za: this.mediaWhitePoint.Z / this.header.PCSilluminant.Z
            };

            this.absoluteAdaptationOut = {
                Xa: this.header.PCSilluminant.X / this.mediaWhitePoint.X,
                Ya: this.header.PCSilluminant.Y / this.mediaWhitePoint.Y,
                Za: this.header.PCSilluminant.Z / this.mediaWhitePoint.Z
            };

            //TODO check for required tags for all profile types...

            // determine the encoding on the A2b Tables
            //this.PCSDecode = this.findA2BEncoding(this.A2B[eIntent.relative]);
            if (_this.header.space === 'RGB ' &&
                _this.A2B[eIntent.relative] === null &&
                _this.B2A[eIntent.relative] === null &&
                _this.rgb.gXYZ &&
                _this.rgb.rXYZ &&
                _this.rgb.bXYZ &&
                _this.rgb.rTRC &&
                _this.rgb.gTRC &&
                _this.rgb.bTRC
            ) {
                // Convert to an RGBMatrix type profile.
                this.createRGBMatrix();
            }

            this.loaded = true;
            return true;
        }

        this.loaded = false;
        return false;

        function scan(outerArray, start, innerArray) {
            for (var i = start; i < outerArray.length - innerArray.length; i++) {
                var found = true;
                for (var j = 0; j < innerArray.length; j++) {
                    if (outerArray[i + j] !== innerArray[j]) {
                        found = false;
                        break;
                    }
                }
                if (found) {
                    return i;
                }
            }
            return -1;
        }
    };

    /**
     * Creates an RGBMatrix representation of the profile
     */
    createRGBMatrix() {
        //this.PCSWhitepoint = convert.getWhitePointFromIlluminant(this.header.PCSilluminant);
        this.PCSWhitepoint = this.header.PCSilluminant;
        var d50 = convert.d50;

        // adapt primaries from D50 as per the ICC spec to the whitepoint of the profile
        //
        //
        var rxy = convert.XYZ2xyY(convert.adaptation(this.rgb.rXYZ, d50, this.mediaWhitePoint), this.PCSWhitepoint);
        var gxy = convert.XYZ2xyY(convert.adaptation(this.rgb.gXYZ, d50, this.mediaWhitePoint), this.PCSWhitepoint);
        var bxy = convert.XYZ2xyY(convert.adaptation(this.rgb.bXYZ, d50, this.mediaWhitePoint), this.PCSWhitepoint);

        this.type = eProfileType.RGBMatrix;

        this.RGBMatrix = {
            gamma: this.rgb.rTRC?.gamma,
            issRGB: (this.name.slice(0, 4) === 'sRGB'),

            cRx: rxy.x,
            cRy: rxy.y,

            cGx: gxy.x,
            cGy: gxy.y,

            cBx: bxy.x,
            cBy: bxy.y
        };

        convert.computeMatrix(this);
    };


    decodeHeader(binary) {
        var header = {};
        header.profileSize = decode.uint32(binary, 0);
        header.cmmType = decode.chars(binary, 4, 4);
        header.version = decode.array(binary, 8, 4);
        header.pClass = decode.chars(binary, 12, 4);
        header.space = decode.chars(binary, 16, 4);
        header.pcs = decode.chars(binary, 20, 4);
        header.date = decode.array(binary, 24, 12);
        header.signature = decode.chars(binary, 36, 4);
        header.platform = decode.chars(binary, 40, 4);
        header.flags = decode.array(binary, 44, 4);
        header.attributes = decode.array(binary, 56, 8);
        header.intent = decode.uint32(binary, 64);
        header.PCSilluminant = decode.XYZNumber(binary, 68);
        return header;
    };

    decodeTags(binary) {
        var tags = [];
        var tagCount = decode.uint32(binary, 128);
        var pos = 128 + 4;
        for (var i = 0; i < tagCount; i++) {
            tags.push({
                sig: decode.chars(binary, pos, 4),
                offset: decode.uint32(binary, pos + 4),
                length: decode.uint32(binary, pos + 8)
            });
            pos += 12;
        }
        return tags;
    };

    decodeFile(binary) {
        this.header = this.decodeHeader(binary);
        this.unsuportedTags = [];

        // copy down important header values
        this.version = this.header.version[0];
        this.pcs = this.header.pcs.trim().toUpperCase();
        this.colorSpace = this.header.space.trim().toUpperCase();

        if (!(this.pcs === 'LAB' || this.pcs === 'XYZ')) {
            this.lastError = { err: 100, text: 'Unsupported PCS [' + this.pcs + ']' };
            return false;
        }

        if (!(this.version === 2 || this.version === 4)) {
            this.lastError = { err: 101, text: 'Unsupported Profile Version [' + this.version + ']' };
            return false;
        }

        switch (this.header.space) {
            case 'GRAY':
                this.outputChannels = 1;
                this.type = eProfileType.Gray;
                break;

            case '2CLR':
                this.outputChannels = 2;
                this.type = eProfileType.Duo;
                break;

            case '3CLR':
            case 'CMY ':
            case 'RGB ':
                this.outputChannels = 3;
                // test LUTs then this will change to RGBMatrix
                this.type = eProfileType.RGBLut;
                break;

            case '4CLR':
            case 'CMYK':
                this.outputChannels = 4;
                this.type = eProfileType.CMYK; // cmyk
                break;

            default:
                this.lastError = { err: 110, text: 'Unsupported Profile Colorspace [' + this.header.space + ']' };
                return false;
        }

        this.tags = this.decodeTags(binary);

        // process common tags
        for (var i = 0; i < this.tags.length; i++) {
            var tag = this.tags[i];
            switch (tag.sig) {
                case 'rXYZ':
                    this.rgb.rXYZ = decode.XYZType(binary, tag.offset);
                    break;
                case 'gXYZ':
                    this.rgb.gXYZ = decode.XYZType(binary, tag.offset);
                    break;
                case 'bXYZ':
                    this.rgb.bXYZ = decode.XYZType(binary, tag.offset);
                    break;

                case 'rTRC':
                    this.rgb.rTRC = decode.curve(binary, tag.offset);
                    this.rgb.rTRCInv = decode.curve(binary, tag.offset, true);
                    break;
                case 'gTRC':
                    this.rgb.gTRC = decode.curve(binary, tag.offset);
                    this.rgb.gTRCInv = decode.curve(binary, tag.offset, true);
                    break;
                case 'bTRC':
                    this.rgb.bTRC = decode.curve(binary, tag.offset);
                    this.rgb.bTRCInv = decode.curve(binary, tag.offset, true);
                    break;

                case 'kTRC':
                    this.Gray.kTRC = decode.curve(binary, tag.offset);
                    this.Gray.inv_kTRC = decode.curve(binary, tag.offset, true);
                    break;

                case 'wtpt':
                    this.mediaWhitePoint = decode.XYZType(binary, tag.offset);
                    break;

                case 'A2B0': //perceptual
                    this.A2B[0] = decode.lut(binary, tag.offset);
                    break;

                case 'A2B1': //relative colorimetric
                    this.A2B[1] = decode.lut(binary, tag.offset);
                    break;

                case 'A2B2': //saturation
                    this.A2B[2] = decode.lut(binary, tag.offset);
                    break;

                case 'B2A0': //perceptual
                    this.B2A[0] = decode.lut(binary, tag.offset);
                    break;
                case 'B2A1': //relative colorimetric
                    this.B2A[1] = decode.lut(binary, tag.offset);
                    break;
                case 'B2A2': //saturation
                    this.B2A[2] = decode.lut(binary, tag.offset);
                    break;

                case 'desc':
                    this.name = decode.text(binary, tag.offset).text;
                    break;

                case 'cprt':
                    this.copyright = decode.text(binary, tag.offset).text;
                    break;
                case 'tech':
                    this.technology = this.techSignatureString(decode.chars(binary, tag.offset, 4));
                    break;
                case 'vued':
                    this.viewingConditions = decode.text(binary, tag.offset);
                    break;
                case 'targ':
                    this.characterizationTarget = decode.text(binary, tag.offset);
                    break;
                case 'bkpt':
                    this.blackPoint = decode.XYZType(binary, tag.offset);
                    break;
                case 'lumi':
                    this.luminance = decode.XYZType(binary, tag.offset);
                    break;
                case 'chad': //chromaticAdaptationTag
                    this.chromaticAdaptation = decode.s15Array(binary, tag.offset, tag.length);
                    break;
                case 'view': //viewingConditionsType
                    this.viewingConditions = decode.viewingConditions(binary, tag.offset);
                    break;
                case 'gamt':
                    // 'Gamut Tag Ignored' for now
                    break;
                case 'calt':
                    // 'Calibration Date Time Tag Ignored' for now
                    break;
                case 'chrm':
                    // chromaticityType Tag Ignored for now
                    break;
                case 'cicp':
                    // Coding-Independent Code Points (CICP) for video signal type identification Ignored for now
                    break;
                case 'clro':
                    // Colorant Order Ignored for now
                    break;
                case 'clrt':
                    // Colorant Table Ignored for now
                    break;
                case 'ciis':
                    // Colorant Table Out of Range Indicator Ignored for now
                    break;
                case 'dmnd':
                    // Device Manufacturer Description Ignored for now
                    break;
                case 'dmdd':
                    // Device Model Description Ignored for now
                    break;
                case 'meas':
                    // Measurement Type Ignored for now
                    break;
                case 'meta':
                    // Metadata Ignored for now
                    break;
                case 'ncl2':
                    // Named Color 2 Ignored for now
                    break;
                case 'resp':
                    // Output Response Ignored for now
                    break;
                case 'rig0':
                    // Perceptual Rendering Intent Gamut Ignored for now
                    break;
                case 'pre0':
                case 'pre1':
                case 'pre2':
                    // Preview 0,1,2 Ignored for now
                    break;
                case 'pseq':
                    // Profile Sequence Description Ignored for now
                    break;
                case 'psid':
                    // Profile Sequence Identifier Ignored for now
                    break;
                case 'rig2':
                    // saturationRenderingIntentGamut Ignored for now
                    break;

                case 'B2D0': //perceptual
                    this.B2D[0] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'B2D1': //relative colorimetric
                    this.B2D[1] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'B2D2': //saturation
                    this.B2D[2] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'B2D3': //absolute colorimetric
                    this.B2D[3] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'D2B0': //perceptual
                    this.D2B[0] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'D2B1': //relative colorimetric
                    this.D2B[1] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'D2B2': //saturation
                    this.D2B[2] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'D2B3': //absolute colorimetric
                    this.D2B[3] = decode.multiProcessElement(binary, tag.offset);
                    break;

                case 'Info':
                    this.info = decode.text(binary, tag.offset);
                    break;

                default:
                    //console.log('Unsupported Tag [' + tag.sig + ']');
                    this.unsuportedTags.push(tag);
            }
        }

        if (this.B2A[eIntent.perceptual] === null) {
            this.B2A[eIntent.perceptual] = this.B2A[eIntent.relative];
        } // No Perceptual, use Colorimetric
        if (this.B2A[eIntent.saturation] === null) {
            this.B2A[eIntent.saturation] = this.B2A[eIntent.perceptual];
        } // No Saturation - use Perceptual

        if (this.A2B[eIntent.perceptual] === null) {
            this.A2B[eIntent.perceptual] = this.A2B[eIntent.relative];
        } // No Perceptual, use Colorimetric
        if (this.A2B[eIntent.saturation] === null) {
            this.A2B[eIntent.saturation] = this.A2B[eIntent.perceptual];
        } // No Saturation - use Perceptual

        if (!(this.header.pClass === 'prtr' ||
            this.header.pClass === 'mntr' ||
            this.header.pClass === 'scnr' ||
            //this.header.pClass === 'link' ||// not supported as yet
            this.header.pClass === 'spac' ||
            this.header.pClass === 'abst'
        )) {
            this.lastError = { err: 100, text: 'profile class not ' + this.header.pClass + ' supported' };
            return false;
        }

        return true;

    };

    techSignatureString(sig) {
        var TechnologySignatures =
            [{ desc: 'Film Scanner', sig: 'fscn' },
            { desc: 'Digital Camera', sig: 'dcam' },
            { desc: 'Reflective Scanner', sig: 'rscn' },
            { desc: 'Ink Jet Printer', sig: 'ijet' },
            { desc: 'Thermal Wax Printer', sig: 'twax' },
            { desc: 'Electrophotographic Printer', sig: 'epho' },
            { desc: 'Electrostatic Printer', sig: 'esta' },
            { desc: 'Dye Sublimation Printer', sig: 'dsub' },
            { desc: 'Photographic Paper Printer', sig: 'rpho' },
            { desc: 'Film Writer', sig: 'fprn' },
            { desc: 'Video Monitor', sig: 'vidm' },
            { desc: 'Video Camera', sig: 'vidc' },
            { desc: 'Projection Television', sig: 'pjtv' },
            { desc: 'Cathode Ray Tube Display', sig: 'CRT ' },
            { desc: 'Passive Matrix Display', sig: 'PMD ' },
            { desc: 'Active Matrix Display', sig: 'AMD ' },
            { desc: 'Photo CD', sig: 'KPCD' },
            { desc: 'PhotoImageSetter', sig: 'imgs' },
            { desc: 'Gravure', sig: 'grav' },
            { desc: 'Offset Lithography', sig: 'offs' },
            { desc: 'Silkscreen', sig: 'silk' },
            { desc: 'Flexography', sig: 'flex' }];

        for (var i = 0; i < TechnologySignatures.length; i++) {
            if (TechnologySignatures[i].sig === sig) {
                return TechnologySignatures[i].desc;
            }
        }
        return '<Unknown Technology Signature>';
    };
}

async function nodeLoadFileFromURL(url, callback) {

    try {
        // @ts-ignore
        const response = await fetch(url, { cache: 'no-store' });

        if (!response.ok) {
            return callback(false, 'Response status was ' + response.status);
        }

        const arrayBuffer = await response.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);

        // console.log('nodeLoadFileFromURL', url, byteArray.length);

        callback(byteArray);
    } catch (error) {
        console.error('Error loading file from URL:', error);

        callback(false, error.message);
    }

    // const http = await import('http');

    // http.get(url, (response) => {
    //     // Check if the request was successful
    //     if (response.statusCode < 200 || response.statusCode >= 300) {
    //         return callback(false, 'Response status was ' + response.statusCode);
    //     }

    //     const chunks = [];

    //     // Listen for data events
    //     response.on('data', (chunk) => {
    //         chunks.push(chunk);
    //     });

    //     // Once all the data has been received
    //     response.on('end', () => {
    //         const buffer = Buffer.concat(chunks);
    //         callback(new Uint8Array(buffer), '');
    //     });
    // }).on('error', (err) => {
    //     callback(false, err.message);
    // });


    // [Symbol.for('nodejs.util.inspect.custom')](depth, options) {
    // }
}


function XHRLoadBinary(url, onComplete) {
    // @ts-ignore
    let xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onload = function () {
        if (this.status === 200) {
            // get binary data as a response
            var arrayBuffer = xhr.response;
            if (arrayBuffer) {
                var byteArray = new Uint8Array(arrayBuffer);
                onComplete(byteArray, '');
            } else {
                onComplete(false, 'Invalid arrayBuffer');
            }
        } else {
            onComplete(false, 'Server Status ' + this.status);
        }
    };

    xhr.ontimeout = function () {
        onComplete(false, 'Timeout');
    };

    xhr.onerror = function () {
        onComplete(false, 'XHR Error');
    };

    xhr.send();
}

function isInCep() {
    try {
        // @ts-ignore
        if (/** @type {*} */(window).cep) return true;
    } catch{}
    return false;
}

function isInNode() {
    try {
        // Check if 'process' is defined
        if (process && process.versions && process.versions.node) {
            return true;
        }
    } catch (e) {
    }
    return false;
}
