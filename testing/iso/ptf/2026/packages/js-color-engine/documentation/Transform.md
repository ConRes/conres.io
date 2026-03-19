# `Transform` Class Documentation

The [`Transform`](#transform-class) class is the main interface for color transformations between different color spaces using ICC profiles. It implements a pipeline-based architecture that mirrors Little-CMS for professional color management.

## Table of Contents

- [`Transform` Class Documentation](#transform-class-documentation)
  - [Table of Contents](#table-of-contents)
    - [`Transform` Class](#transform-class)
      - [Overview](#overview)
        - [Pipeline Positions](#pipeline-positions)
        - [Data Format Options](#data-format-options)
      - [Constructor](#constructor)
        - [`Transform(options?)`](#transformoptions)
      - [`TransformOptions`](#transformoptions-1)
      - [`_Stage`](#_stage)
      - [`CustomStage`](#customstage)
      - [`LookupTable`](#lookuptable)
      - [`PipelinePosition`](#pipelineposition)
      - [`ProfileObject`](#profileobject)
    - [Configuration Properties](#configuration-properties)
      - [`dataFormat`](#dataformat)
      - [`options`](#options)
      - [`_BPCAutoEnable` _private_](#_bpcautoenable-private)
      - [`_expandRGBStages` _private_](#_expandrgbstages-private)
      - [`_RGBMatrixWhiteAdadaptation` _private_](#_rgbmatrixwhiteadadaptation-private)
    - [Pipeline Properties](#pipeline-properties)
      - [`pipeline`](#pipeline)
      - [`prebuiltLUT`](#prebuiltlut)
      - [`inputProfile`](#inputprofile)
      - [`outputProfile`](#outputprofile)
    - [Pipeline Creation Methods](#pipeline-creation-methods)
      - [`create(inputProfile, outputProfile, intent, customStages?)`](#createinputprofile-outputprofile-intent-customstages)
      - [`createPipeline(profileChain, convertInput?, convertOutput?, useCachedLut?)` _private_](#createpipelineprofilechain-convertinput-convertoutput-usecachedlut-private)
      - [`verifyPipeline()` _private_](#verifypipeline-private)
      - [`optimizePipeline()` _private_](#optimizepipeline-private)
    - [LUT Management Methods](#lut-management-methods)
      - [getLut(precision?)](#getlutprecision)
      - [`getLut16()`](#getlut16)
      - [`getLut8()`](#getlut8)
      - [`setLut(lut)`](#setlutlut)
    - [LUT Creation Methods](#lut-creation-methods)
      - [`createLut()`](#createlut)
      - [`create1DDeviceLUT(outputChannels, gridPoints)`](#create1ddevicelutoutputchannels-gridpoints)
      - [`create2DDeviceLUT(outputChannels, gridPoints)`](#create2ddevicelutoutputchannels-gridpoints)
      - [`create3DDeviceLUT(outputChannels, gridPoints)`](#create3ddevicelutoutputchannels-gridpoints)
      - [`create3DDeviceLUT_KOnly(outputChannels, gridPoints)`](#create3ddevicelut_konlyoutputchannels-gridpoints)
      - [`create4DDeviceLUT(outputChannels, gridPoints)`](#create4ddevicelutoutputchannels-gridpoints)
    - [Profile Analysis Methods](#profile-analysis-methods)
      - [`getProfileChannels(profile)` _private_](#getprofilechannelsprofile-private)
      - [`getInput2DevicePCSInfo(inputProfile)` _private_](#getinput2devicepcsinfoinputprofile-private)
      - [`getDevice2OutputPCSInfo(outputProfile)` _private_](#getdevice2outputpcsinfooutputprofile-private)
    - [Transformation Methods](#transformation-methods)
      - [`forward(cmsColor)`](#forwardcmscolor)
      - [`transform(cmsColor)`](#transformcmscolor)
    - [GCR Support Methods](#gcr-support-methods)
      - [`applyGrayComponentReplacement(rgb)`](#applygraycomponentreplacementrgb)
      - [`transformRGBtoLab(rgb)`](#transformrgbtolabrgb)
      - [`labF(t)`](#labft)
    - [Utility Methods](#utility-methods)
      - [`cloneLut(CLUT, encoding)`](#clonelutclut-encoding)
      - [`intent2LUTIndex(intent)`](#intent2lutindexintent)
      - [`intent2String(intent)`](#intent2stringintent)
      - [`chainInfo()`](#chaininfo)
      - [`historyInfo()`](#historyinfo)
      - [`debugInfo()`](#debuginfo)
    - [Static Properties](#static-properties)
      - [REVISION](#revision)
    - [Usage Examples](#usage-examples)
      - [Basic Two-Profile Transform](#basic-two-profile-transform)
      - [Multi-Stage Proofing Transform](#multi-stage-proofing-transform)
      - [Custom Stage Insertion](#custom-stage-insertion)
    - [LUT Optimization Workflow](#lut-optimization-workflow)
    - [Debug and Analysis](#debug-and-analysis)

---

### `Transform` Class

#### Overview

**Source**: [`transform.js:169`](../transform.js#L169)

The Transform class provides:

- Single and multi-stage color transformations
- Custom stage insertion at various pipeline positions
- Multiple data format support (object, float, int8, int16, device)
- LUT optimization for improved performance
- Debug capabilities for transformation analysis

##### Pipeline Positions

Custom stages can be inserted at these pipeline positions:

- `'beforeInput2Device'` - Before input profile processing
- `'beforeDevice2PCS'` - Before device to PCS conversion
- `'afterDevice2PCS'` - After device to PCS conversion
- `'PCS'` - In the Profile Connection Space
- `'beforePCS2Device'` - Before PCS to device conversion
- `'afterPCS2Device'` - After PCS to device conversion
- `'afterDevice2Output'` - After output profile processing

##### Data Format Options

- `'object'` - Structured format `{type: eColourType, R:0, G:0, B:0}`
- `'objectFloat'` - Same as object but with floats (0.0-1.0)
- `'int8'` - 8-bit integer array (0-255)
- `'int16'` - 16-bit integer array (0-65535)
- `'device'` - n-Channel floats array (0.0-1.0)

#### Constructor

##### `Transform(options?)`

**Source**: [`transform.js:171`](../transform.js#L171)

Creates a new [`Transform`](#transform-class) instance with optional configuration.

```typescript
constructor(options?: TransformOptions)
```

**Parameters:**

- `options` ([`TransformOptions`](#transformoptions)) - Optional configuration options

**Example:**

```javascript
const transform = new Transform({
  dataFormat: 'objectFloat',
  useBPC: true,
  interpolation: 'tetrahedral',
  pipelineDebug: true
});
```

#### `TransformOptions`

**Source**: [`transform.js:70`](../transform.js#L70)

Configuration options for [`Transform`](#transform-class) instances.

```typescript
interface TransformOptions {
  // LUT Options
  buildLUT?: boolean;           // Precompute LUT for faster conversion (default: false)
  lutGridPoints3D?: number;     // Grid points for 3D LUTs: 17, 33, or 65 (default: 33)
  lutGridPoints4D?: number;     // Grid points for 4D LUTs: 11, 17, or 33 (default: 17)
  
  // Interpolation Options
  interpolationFast?: boolean;           // Use faster interpolation (less accurate)
  interpolation?: 'tetrahedral'|'trilinear';     // 3D/4D pipeline interpolation
  interpolation3D?: 'tetrahedral'|'trilinear';   // 3D pipeline interpolation
  interpolation4D?: 'tetrahedral'|'trilinear';   // 4D pipeline interpolation
  LUTinterpolation?: 'tetrahedral'|'trilinear';  // 3D/4D LUT interpolation method
  LUTinterpolation3D?: 'tetrahedral'|'trilinear'; // 3D LUT interpolation method
  LUTinterpolation4D?: 'tetrahedral'|'trilinear'; // 4D LUT interpolation method
  
  // Data Format Options
  dataFormat?: 'object'|'objectFloat'|'int8'|'int16'|'device'; // Data format (default: 'object')
  useFloats?: boolean;          // Obsolete, use dataFormat instead
  
  // Color Management Options
  useAdaptation?: boolean;      // Enable chromatic adaptation
  useBPC?: boolean;            // Enable Black Point Compensation
  _BPCAutoEnable?: boolean;    // Obsolete, use autoEnableBPC instead
  autoEnableBPC?: boolean;     // Automatically enable BPC if needed
  labInputAdaptation?: boolean; // Adapt input Lab colors to D50 white point (default: false)
  labAdaptation?: boolean;     // Adapt Lab colors to D50 white point (default: false)
  displayChromaticAdaptation?: boolean; // Apply chromatic adaptation (default: true)
  
  // Debug and Optimization Options
  pipelineDebug?: boolean;     // Enable pipeline debugging (default: false)
  optimize?: boolean;          // Optimize pipeline to remove unnecessary conversions (default: true)
  verbose?: boolean;           // Enable verbose logging (default: false)
  verboseTiming?: boolean;     // Enable verbose timing information (default: false)
  clipRGBinPipeline?: boolean; // Enable RGB clipping in the pipeline (default: false)
  
  // Output Options
  roundOutput?: boolean;       // Round output to specified precision (default: false)
  precision?: number;          // Decimal places for rounding (default: 0)
  
  // Advanced Options
  BPC?: boolean|boolean[];     // Black Point Compensation settings (default: false)
  preserveGray?: boolean;      // Preserve gray levels during transformation (default: false)
  useLegacy?: boolean;         // Use legacy LUT implementation for backward compatibility (default: false)
  useLegacyInterpolation?: boolean; // Use legacy interpolation implementations (default: false)
  promoteGrayToCMYKBlack?: boolean; // Promote gray values to CMYK black channel (default: false)
  preserveCMYKPrimaries?: boolean;  // Preserve CMYK primary colors (default: false)
  debugging?: Record<string, any>;  // Debugging options object
}
```

#### `_Stage`

**Source**: [`transform.js:37`](../transform.js#L37)

Internal stage interface for pipeline construction.

#### `CustomStage`

**Source**: [`transform.js:42`](../transform.js#L42)

Interface for custom pipeline stages.

```typescript
interface CustomStage {
  name: string;                    // Custom stage name
  position: PipelinePosition;      // Pipeline position for insertion
  stageFn: Function;              // Custom transformation function
  stageData: object;              // Custom data for this stage
  data?: object;                  // Stage-specific data (alternative)
  location?: PipelinePosition;    // Location in the pipeline (alternative to position)
  description?: string;           // Human-readable description
}
```

#### `LookupTable`

**Source**: [`transform.js:133`](../transform.js#L133)

Lookup table structure for optimized transformations.

```typescript
interface LookupTable {
  CLUT: number[];              // Color lookup table data
  inputChannels: number;       // Number of input channels (3 or 4)
  outputChannels: number;      // Number of output channels (3 or 4)
  gridPoints: number;          // Number of grid points per dimension
  interpolation: string;       // Interpolation method used
  metadata?: object;           // Additional LUT metadata
}
```

#### `PipelinePosition`

**Source**: [`transform.js:143`](../transform.js#L143)

Valid positions for custom stage insertion in the pipeline.

```typescript
type PipelinePosition = 
  | 'beforeInput2Device'
  | 'beforeDevice2PCS' 
  | 'afterDevice2PCS'
  | 'PCS'
  | 'beforePCS2Device'
  | 'afterPCS2Device'
  | 'afterDevice2Output';
```

#### `ProfileObject`

**Source**: [`transform.js:149`](../transform.js#L149)

Valid profile types for pipeline stages.

```typescript
interface ProfileObject {
  PCSDecode: number | any;
  PCS8BitScale: number | any;
  viewingConditions: string | any;
  whitePoint: any;
  PCSEncode: number | any;
  name: any;
  header: any;
  description: any;
  type: any;
  intent: any;
  version: any;
  mediaWhitePoint: any;
}
```

### Configuration Properties

#### `dataFormat`

**Source**: [`transform.js:212`](../transform.js#L212)

```typescript
dataFormat: TransformOptions['dataFormat']
```

Current data format setting for input\/../output color data.

#### `options`

**Source**: [`transform.js:215`](../transform.js#L215)

```typescript
options: TransformOptions
```

Current transformation options and settings.

#### `_BPCAutoEnable` _private_

**Source**: [`transform.js:262`](../transform.js#L262)

```typescript
_BPCAutoEnable: boolean
```

Internal flag for automatic Black Point Compensation enablement when needed.

#### `_expandRGBStages` _private_

**Source**: [`transform.js:265`](../transform.js#L265)

```typescript
_expandRGBStages: boolean
```

Internal flag controlling whether RGB matrix profiles should be expanded into individual stages.

#### `_RGBMatrixWhiteAdadaptation` _private_

**Source**: [`transform.js:266`](../transform.js#L266)

```typescript
_RGBMatrixWhiteAdadaptation: boolean
```

Internal flag for controlling white point adaptation in RGB matrix transformations.

### Pipeline Properties

#### `pipeline`

**Source**: [`transform.js:270`](../transform.js#L270)

```typescript
pipeline: _Stage[]
```

Array of transformation stages that will be executed in sequence.

#### `prebuiltLUT`

**Source**: [`transform.js:277`](../transform.js#L277)

```typescript
prebuiltLUT: import('./decode.js').LUT | false
```

Precomputed lookup table for optimized transformations, or false if not built.

#### `inputProfile`

**Source**: [`transform.js:279`](../transform.js#L279)

```typescript
inputProfile: Profile | null
```

Source color profile for the transformation.

#### `outputProfile`

**Source**: [`transform.js:281`](../transform.js#L281)

```typescript
outputProfile: Profile | null
```

Destination color profile for the transformation.

### Pipeline Creation Methods

#### `create(inputProfile, outputProfile, intent, customStages?)`

**Source**: [`transform.js:302`](../transform.js#L302)

Creates a basic two-profile transformation pipeline.

**Signature:**

```typescript
create(
  inputProfile: ProfileObject,
  outputProfile: ProfileObject,
  intent: eIntent,
  customStages?: CustomStage[]
): void
```

**Parameters:**

- `inputProfile` - Source color profile (Profile instance or virtual profile name like `'*sRGB'`)#### `createMultiStage(sourceProfileChain, customStages?)`

**Source**: [`transform.js:334`](../transform.js#L334)

Creates a complex multi-stage proofing transformation pipeline.

```typescript
createMultiStage(
  sourceProfileChain: (string | Profile | eIntent)[], 
  customStages?: CustomStage[]
): void
```

**Parameters:**

- `sourceProfileChain` - Array alternating between profiles and intents
- `customStages` - Optional custom transformation stages

**Description:**
Creates transforms from two OR MORE profiles. Useful for proofing workflows where you need to simulate the full print process including device conversions.

**Examples:**

Proofing simulation:

```javascript
const profileChain = [
  '*sRGB', eIntent.perceptual, 
  cmykProfile, eIntent.relative, 
  '*sRGB'
];
transform.createMultiStage(profileChain);
```

DeltaE calculation chain:

```javascript
const profileChain = [
  '*lab', eIntent.relative, '*sRGB',
  '*sRGB', eIntent.perceptual, cmykProfile,
  cmykProfile, eIntent.absolute, '*lab'
];
transform.createMultiStage(profileChain);
```

#### `createPipeline(profileChain, convertInput?, convertOutput?, useCachedLut?)` _private_

**Source**: [`transform.js:1845`](../transform.js#L1845)

Creates the internal transformation pipeline from a chain of profiles.

```typescript
createPipeline(
  profileChain: ProfileObject[], 
  convertInput?: boolean, 
  convertOutput?: boolean, 
  useCachedLut?: boolean
): void
```

**Parameters:**

- `profileChain` - Array of profile objects to chain together
- `convertInput` - Whether to convert input to PCS format
- `convertOutput` - Whether to convert output from PCS format  
- `useCachedLut` - Whether to use cached lookup tables

**Description:**
Internal method that builds the pipeline stages from profile chain. Handles chromatic adaptation, black point compensation, and stage optimization.

#### `verifyPipeline()` _private_

**Source**: [`transform.js:2012`](../transform.js#L2012)

Validates the constructed pipeline for correctness.

```typescript
verifyPipeline(): boolean
```

**Returns:** `boolean` - true if pipeline is valid

**Description:**
Checks pipeline integrity, color space compatibility, and stage connectivity.

#### `optimizePipeline()` _private_

**Source**: [`transform.js:2156`](../transform.js#L2156)

Optimizes the pipeline by removing redundant stages and merging compatible operations.

```typescript
optimizePipeline(): void
```

**Description:**
Analyzes the pipeline for optimization opportunities such as matrix concatenation, LUT merging, and identity stage removal.

### LUT Management Methods

#### getLut(precision?)

**Source**: [`transform.js:290`](../transform.js#L290)

Gets the prebuilt lookup table with optional precision rounding.

```typescript
getLut(precision?: number): LUT
```

**Parameters:**

- `precision` - Number of decimal places to round LUT values to (for smaller JSON output)

**Returns:**
The LUT can be used in future transformations instead of using profiles for better performance.

**Example:**

```javascript
const lut = transform.getLut(4); // Round to 4 decimal places
// Save LUT to file or database for reuse
```

#### `getLut16()`

**Source**: [`transform.js:298`](../transform.js#L298)

Gets the prebuilt lookup table as 16-bit integers.

```typescript
getLut16(): LUT
```

**Returns:**
16-bit integer representation (0-65535) of the LUT, used for ICC profile generation or systems that require integer LUT data.

#### `getLut8()`

**Source**: [`transform.js:305`](../transform.js#L305)

Gets the prebuilt lookup table as 8-bit integers.

```typescript
getLut8(): LUT
```

**Returns:**
8-bit lookup table for low fidelity color transformations (0-255 range).

#### `setLut(lut)`

**Source**: [`transform.js:312`](../transform.js#L312)

Sets a prebuilt lookup table for use instead of profiles.

```typescript
setLut(lut: import('./decode.js').LUT): void
```

**Parameters:**

- `lut` ([`LUT`](./Common.md#lut)) - Precomputed lookup table to use

**Example:**

```javascript
// Load saved LUT and reuse it
const savedLut = JSON.parse(lutJsonString);
transform.setLut(savedLut);
```

### LUT Creation Methods

#### `createLut()`

**Source**: [`transform.js:421`](../transform.js#L421)

Creates a prebuilt LUT from the current pipeline.

```typescript
createLut(): import('./decode.js').LUT
```

**Returns:**
LUT compatible with ICCProfile LUT structure for use in trilinear/tetrahedral stages.

#### `create1DDeviceLUT(outputChannels, gridPoints)`

**Source**: [`transform.js:430`](../transform.js#L430)

Creates a 1D device lookup table for monotone transformations.

```typescript
create1DDeviceLUT(outputChannels: number, gridPoints: number): Float64Array
```

**Parameters:**

- `outputChannels` - Number of output color channels
- `gridPoints` - Number of grid points for the lookup table

**Returns:**
1D device lookup table as Float64Array for monotone transformations.

#### `create2DDeviceLUT(outputChannels, gridPoints)`

**Source**: [`transform.js:437`](../transform.js#L437)

Creates a 2D device lookup table for duotone transformations.

```typescript
create2DDeviceLUT(outputChannels: number, gridPoints: number): Float64Array
```

**Parameters:**

- `outputChannels` - Number of output color channels
- `gridPoints` - Number of grid points for the lookup table

**Returns:**
2D device lookup table as Float64Array for duotone transformations.

#### `create3DDeviceLUT(outputChannels, gridPoints)`

**Source**: [`transform.js:450`](../transform.js#L450)

Creates a 3D device lookup table for RGB/Lab transformations.

```typescript
create3DDeviceLUT(outputChannels: number, gridPoints: number): Float32Array
```

**Parameters:**

- `outputChannels` - Number of output color channels
- `gridPoints` - Number of grid points for the lookup table

**Returns:**
3D device lookup table as Float32Array for RGB/Lab transformations.

**Description:**
Since RGB, RGBMatrix and Lab all use device encoding inputs (0.0-1.0), they can create LUTs using the same method.

#### `create3DDeviceLUT_KOnly(outputChannels, gridPoints)`

**Source**: [`transform.js:457`](../transform.js#L457)

Creates a 3D Device LUT with sophisticated Gray Component Replacement (GCR).

```typescript
create3DDeviceLUT_KOnly(outputChannels: number, gridPoints: number): Float64Array
```

**Parameters:**

- `outputChannels` - Number of output channels (should be 4 for CMYK)
- `gridPoints` - Number of grid points per dimension for LUT resolution

**Returns:**
Properly structured 3D device LUT with GCR processing applied.

**Description:**
This method implements sophisticated Gray Component Replacement (GCR) theory:

**GCR Theory:**

- GCR is a colorimetrically-sound technique for optimizing CMYK printing
- Replaces equivalent amounts of Cyan, Magenta, and Yellow inks with Black ink
- Reduces overall ink consumption (lower TAC - Total Area Coverage)
- Improves print stability and quality while maintaining color appearance

**Colorimetric Justification:**

- Equal amounts of CMY create a neutral gray component
- Black ink can reproduce the same neutral with better characteristics
- Lab color space analysis ensures visual equivalence is maintained
- Relative colorimetric intent + BPC provides better control than perceptual

**Implementation Strategy:**

1. **Neutrality Detection**: Use Lab space to identify gray components in CMY
2. **CMY Analysis**: Identify dominant and secondary color components
3. **Systematic Reduction**: Incrementally reduce CMY while increasing K
4. **Quality Control**: Verify each step maintains color integrity

#### `create4DDeviceLUT(outputChannels, gridPoints)`

**Source**: [`transform.js:673`](../transform.js#L673)

Creates a 4D device lookup table for CMYK transformations.

```typescript
create4DDeviceLUT(outputChannels: number, gridPoints: number): Float32Array
```

**Parameters:**

- `outputChannels` - Number of output color channels
- `gridPoints` - Number of grid points for the lookup table

**Returns:**
4D device lookup table as Float32Array for CMYK transformations.

### Profile Analysis Methods

#### `getProfileChannels(profile)` _private_

**Source**: [`transform.js:3862`](../transform.js#L3862)

Internal method for determining the number of channels in a profile.

```typescript
getProfileChannels(profile: Profile): number
```

**Parameters:**

- `profile` - Profile to analyze

**Returns:** `number` - Number of color channels in the profile

**Description:**
Analyzes ICC profile headers to determine channel count for pipeline construction.

#### `getInput2DevicePCSInfo(inputProfile)` _private_

**Source**: [`transform.js:3879`](../transform.js#L3879)

Internal method for analyzing input profile PCS information.

```typescript
getInput2DevicePCSInfo(inputProfile: Profile): object
```

**Parameters:**

- `inputProfile` - Input profile to analyze

**Returns:** `object` - PCS connection information

**Description:**
Extracts Profile Connection Space metadata needed for device-to-PCS transformations.

#### `getDevice2OutputPCSInfo(outputProfile)` _private_

**Source**: [`transform.js:3898`](../transform.js#L3898)

Internal method for analyzing output profile PCS information.

```typescript
getDevice2OutputPCSInfo(outputProfile: Profile): object
```

**Parameters:**

- `outputProfile` - Output profile to analyze

**Returns:** `object` - PCS connection information

**Description:**
Extracts Profile Connection Space metadata needed for PCS-to-device transformations.

### Transformation Methods

#### `forward(cmsColor)`

**Source**: [`transform.js:3412`](../transform.js#L3412)

Transforms a color through the pipeline.

```typescript
forward(cmsColor: ColorObject): ColorObject
```

**Parameters:**

- `cmsColor` - Input color in the format specified by `dataFormat`

**Returns:** `ColorObject` - Transformed color

**Description:**
Executes the full transformation pipeline on the input color.

#### `transform(cmsColor)`

**Source**: [`transform.js:3412`](../transform.js#L3412)

Alias for `forward()` method.

```typescript
transform(cmsColor: ColorObject): ColorObject
```

### GCR Support Methods

#### `applyGrayComponentReplacement(rgb)`

**Source**: [`transform.js:2678`](../transform.js#L2678)

Applies Gray Component Replacement (GCR) to RGB input for optimized CMYK printing.

```typescript
applyGrayComponentReplacement(rgb: number[]): number[]
```

**Parameters:**

- `rgb` - Input RGB values in device space [0-1]

**Returns:** `number[]` - CMYK values with GCR applied

**Description:**
GCR is a colorimetrically-sound technique for optimizing CMYK printing by replacing equal amounts of CMY with black ink. This reduces ink consumption and improves print quality.

#### `transformRGBtoLab(rgb)`

**Source**: [`transform.js:2712`](../transform.js#L2712)

Converts RGB values to Lab color space for gray component analysis.

```typescript
transformRGBtoLab(rgb: number[]): number[]
```

**Parameters:**

- `rgb` - Input RGB values in device space [0-1]

**Returns:** `number[]` - Lab values [L, a, b]

**Description:**
Used internally by GCR to analyze color neutrality in perceptually uniform Lab space.

#### `labF(t)`

**Source**: [`transform.js:2734`](../transform.js#L2734)

Lab color space transfer function for precise color calculations.

```typescript
labF(t: number): number
```

**Parameters:**

- `t` - Input value

**Returns:** `number` - Transformed value

**Description:**
Implements the CIE Lab transfer function for accurate color space conversions.

### Utility Methods

#### `cloneLut(CLUT, encoding)`

**Source**: [`transform.js:2812`](../transform.js#L2812)

Creates a deep copy of a lookup table with optional encoding conversion.

```typescript
cloneLut(CLUT: number[], encoding: string): number[]
```

**Parameters:**

- `CLUT` - Color lookup table data to clone
- `encoding` - Target encoding for the cloned LUT

**Returns:**
Cloned LUT with the specified encoding.

#### `intent2LUTIndex(intent)`

**Source**: [`transform.js:2856`](../transform.js#L2856)

Converts rendering intent enum to LUT array index.

```typescript
intent2LUTIndex(intent: eIntent): number
```

**Parameters:**

- `intent` - Rendering intent enum value

**Returns:** `number` - Corresponding LUT index

#### `intent2String(intent)`

**Source**: [`transform.js:2871`](../transform.js#L2871)

Converts rendering intent enum to human-readable string.

```typescript
intent2String(intent: eIntent): string
```

**Parameters:**

- `intent` - Rendering intent enum value

**Returns:** `string` - Intent name ('perceptual', 'relative', 'saturation', 'absolute')

#### `chainInfo()`

**Source**: [`transform.js:2945`](../transform.js#L2945)

Returns detailed information about the transformation chain.

```typescript
chainInfo(): string
```

**Returns:** `string` - Formatted chain information

**Description:**
Provides a human-readable summary of the pipeline stages, profiles, and intents.

#### `historyInfo()`

**Source**: [`transform.js:2967`](../transform.js#L2967)

Returns transformation history and performance metrics.

```typescript
historyInfo(): object
```

**Returns:** `object` - History and timing information

#### `debugInfo()`

**Source**: [`transform.js:2989`](../transform.js#L2989)

Returns comprehensive debug information about the pipeline state.

```typescript
debugInfo(): object
```

**Returns:** `object` - Debug data including stages, matrices, and LUTs

### Static Properties

#### REVISION

**Source**: [`transform.js:454`](../transform.js#L454)

```typescript
static readonly REVISION: string = 'x16c'
```

Current revision identifier for the [`Transform`](#transform-class) class implementation.

### Usage Examples

#### Basic Two-Profile Transform

```javascript
import { Transform, Profile } from './js-color-engine/main.js';
import { eIntent } from './js-color-engine/def.js';

// Create transform
const transform = new Transform({
  dataFormat: 'objectFloat',
  useBPC: true,
  interpolation: 'tetrahedral'
});

// Load profiles
const inputProfile = new Profile('*sRGB');
const outputProfile = new Profile('./cmyk-profile.icc');

// Create transformation pipeline
transform.create(inputProfile, outputProfile, eIntent.perceptual);

// Transform colors
const inputColor = { type: eColourType.RGBf, Rf: 1.0, Gf: 0.5, Bf: 0.2 };
const outputColor = transform.forward(inputColor);
```

#### Multi-Stage Proofing Transform

```javascript
// Create proofing transform: sRGB → CMYK → sRGB (simulation)
const profileChain = [
  '*sRGB',           // Input profile
  eIntent.perceptual, // Intent for sRGB → CMYK
  cmykProfile,       // CMYK press profile
  eIntent.relative,   // Intent for CMYK → sRGB
  '*sRGB'            // Output profile (display)
];

const transform = new Transform({ useBPC: true });
transform.createMultiStage(profileChain);

// Now colors are transformed through the full print simulation
const simulatedColor = transform.forward(originalColor);
```

#### Custom Stage Insertion

```javascript
// Custom gamma correction stage
const customStages = [{
  name: 'custom-gamma',
  position: 'afterDevice2PCS',
  stageFn: (colorData, stageData, stage) => {
    // Apply custom gamma correction
    colorData[0] = Math.pow(colorData[0], 1.0 / 2.2);
    colorData[1] = Math.pow(colorData[1], 1.0 / 2.2);
    colorData[2] = Math.pow(colorData[2], 1.0 / 2.2);
    return colorData;
  },
  stageData: { gamma: 2.2 }
}];

transform.create(inputProfile, outputProfile, eIntent.relative, customStages);
```

### LUT Optimization Workflow

```javascript
// Create transform with LUT optimization
const transform = new Transform({
  buildLUT: true,
  lutGridPoints3D: 33,
  LUTinterpolation: 'tetrahedral'
});

transform.create('*sRGB', cmykProfile, eIntent.perceptual);

// Get LUT for saving/reuse
const lut = transform.getLut(4); // 4 decimal precision
localStorage.setItem('transform-lut', JSON.stringify(lut));

// Later, reuse the LUT
const savedLut = JSON.parse(localStorage.getItem('transform-lut'));
const fastTransform = new Transform();
fastTransform.setLut(savedLut);
```

### Debug and Analysis

```javascript
// Enable debugging
const transform = new Transform({
  pipelineDebug: true,
  verbose: true,
  verboseTiming: true
});

transform.create('*sRGB', cmykProfile, eIntent.perceptual);

// Transform with detailed logging
const result = transform.forward(inputColor);
// Debug information will be logged to console

// Inspect pipeline stages
console.log('Pipeline stages:', transform.pipeline.length);
transform.pipeline.forEach((stage, i) => {
  console.log(`Stage ${i}: ${stage.stageName}`);
});
```
