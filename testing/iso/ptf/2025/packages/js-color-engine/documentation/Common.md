# Common Types and Definitions

This document contains shared type definitions, enumerations, and interfaces used throughout the js-color-engine.

## Table of Contents

- [Common Types and Definitions](#common-types-and-definitions)
  - [Table of Contents](#table-of-contents)
  - [Enumerations](#enumerations)
    - [`eColourType`](#ecolourtype)
    - [`eProfileType`](#eprofiletype)
    - [`eIntent`](#eintent)
    - [`encoding`](#encoding)
  - [Color Object Types](#color-object-types)
    - [`_cmsWhitePoint`](#_cmswhitepoint)
    - [`_cmsRGB`](#_cmsrgb)
    - [`_cmsRGBf`](#_cmsrgbf)
    - [`_cmsCMYK`](#_cmscmyk)
    - [`_cmsCMYKf`](#_cmscmykf)
    - [`_cmsLab`](#_cmslab)
    - [`_cmsLabD50`](#_cmslabd50)
    - [`_cmsXYZ`](#_cmsxyz)
    - [`_cmsLCH`](#_cmslch)
    - [`_cmsGray`](#_cmsgray)
    - [`_cmsDuo`](#_cmsduo)
    - [`_cmsDuof`](#_cmsduof)
    - [`_cmsxyY`](#_cmsxyy)
    - [`ColorObject`](#colorobject)
  - [Utility Types](#utility-types)
    - [`_Device`](#_device)
    - [`_PCS`](#_pcs)
    - [`_PCSf`](#_pcsf)
    - [`stageEncoding`](#stageencoding)
  - [Matrix and Profile Types](#matrix-and-profile-types)
    - [`Matrix3x3`](#matrix3x3)
    - [`RGBMatrix`](#rgbmatrix)
    - [`RGBProfile`](#rgbprofile)
  - [LUT and Pipeline Types](#lut-and-pipeline-types)
    - [`LUT`](#lut)
    - [`CurveV2`](#curvev2)
    - [`CurveV4`](#curvev4)
    - [`_Stage`](#_stage)
  - [Constants](#constants)
    - [`illuminant`](#illuminant)
    - [`encodingStr`](#encodingstr)
    - [`u1Fixed15NumberMax`](#u1fixed15numbermax)
  - [Utility Functions](#utility-functions)
    - [`eProfileTypeToString`](#eprofiletypetostring)
    - [`intent2String`](#intent2string)
    - [`cgatsIntentString`](#cgatsintentstring)
    - [`roundN`](#roundn)
  - [Array Conversion Utilities](#array-conversion-utilities)
    - [`uint8ArrayToBase64`](#uint8arraytobase64)
    - [`uint16ArrayToBase64`](#uint16arraytobase64)
    - [`base64ToUint16Array`](#base64touint16array)
    - [`base64ToUint8Array`](#base64touint8array)

## Enumerations

### `eColourType`

**Source**: [`def.js:17`](../def.js#L17)

Color type enumeration for different color space representations. Used to identify the type of color object and determine appropriate conversion methods.

```typescript
enum eColourType {
  None = 0,      // No color type specified
  XYZ = 1,       // XYZ tristimulus color space
  Lab = 2,       // Lab color space (L*a*b*)
  LCH = 3,       // LCH color space (Lightness, Chroma, Hue)
  Gray = 4,      // Grayscale color space
  RGB = 5,       // RGB color space with integer values (0-255)
  CMYK = 6,      // CMYK color space with integer values (0-255)
  custom = 7,    // Custom color space
  RGBf = 8,      // RGB color space with floating-point values (0.0-1.0)
  CMYKf = 9,     // CMYK color space with floating-point values (0.0-1.0)
  Spectrum = 10, // Spectral color representation
  Grayf = 11,    // Grayscale with floating-point values (0.0-1.0)
  Duo = 12,      // Duo-tone color space
  Duof = 13,     // Duo-tone with floating-point values
  xyY = 14       // xyY color space
}
```

**Used in:**

- Transform.md: [`forward()`](./Transform.md#forwardcmscolor), [`transform()`](./Transform.md#transformcmscolor) - Input\/../output color parameters

### `eProfileType`

**Source**: [`def.js:58`](../def.js#L58)

ICC profile type enumeration for different color space profiles. Determines the internal structure and transformation methods for ICC profiles.

```typescript
enum eProfileType {
  Lab = 0,       // Lab color space profile
  RGBMatrix = 1, // RGB matrix-based profile
  RGBLut = 2,    // RGB LUT-based profile
  CMYK = 3,      // CMYK color space profile
  Gray = 4,      // Grayscale profile
  Duo = 5,       // Duo-tone profile
  XYZ = 6        // XYZ color space profile
}
```

**Used in:**

- Profile.md: [`type`](./Profile.md#type) - Profile type identification

### `eIntent`

**Source**: [`def.js:108`](../def.js#L108)

Rendering intent enumeration for color management transformations. Defines how colors should be converted when the source and destination gamuts differ.

```typescript
enum eIntent {
  perceptual = 0, // Perceptual rendering intent - maintains overall appearance
  relative = 1,   // Relative colorimetric rendering intent - maintains color accuracy within gamut
  saturation = 2, // Saturation rendering intent - maintains saturation over accuracy
  absolute = 3    // Absolute colorimetric rendering intent - maintains absolute color accuracy
}
```

**Used in:**

- Transform.md: [`create()`](./Transform.md#createinputprofile-outputprofile-intent-customstages), [`createMultiStage()`](./Transform.md#createmultistagesourceprofilechain-customstages), [`intent2LUTIndex()`](./Transform.md#intent2lutindexintent), [`intent2String()`](./Transform.md#intent2stringintent) - Rendering intent parameters

### `encoding`

**Source**: [`def.js:245`](../def.js#L245)

Encoding specifications for different data formats and color spaces. Defines how color data is represented internally during transformations.

```typescript
enum encoding {
  device = 0,   // Device-dependent color space encoding (0.0 to 1.0)
  PCSv2 = 1,    // ICC v2 PCS encoding (0.0 to 1.0 based on 16bit where 0xFF00 = 1.0)
  PCSv4 = 2,    // ICC v4 PCS encoding (0.0 to 1.0 based on 16bit where 0xFFFF = 1.0)
  PCSXYZ = 3,   // XYZ Profile Connection Space encoding
  LabD50 = 3,   // Lab D50 color space encoding (same as PCSXYZ)
  cmsLab = 4,   // CMS Lab color space encoding
  cmsRGB = 5,   // CMS RGB color space encoding
  cmsCMYK = 6,  // CMS CMYK color space encoding
  cmsXYZ = 7    // CMS XYZ color space encoding
}
```

**Used in:**

- Transform.md: Internal pipeline encoding specifications, LUT data format encoding

## Color Object Types

### `_cmsWhitePoint`

**Sources**: [`def.js:305`](../def.js#L305), [`convert.js:14`](../convert.js#L14)

Standard illuminant definition with XYZ tristimulus values for chromatic adaptation and white point calculations.

```typescript
interface _cmsWhitePoint {
  desc: string;  // White point description (e.g., 'd50', 'd65', 'a')
  X: number;     // X tristimulus value (typically around 0.9-1.1)
  Y: number;     // Y tristimulus value (typically 1.0)
  Z: number;     // Z tristimulus value (typically 0.3-1.3)
}
```

**Used in:**

- Profile.md: [`mediaWhitePoint`](./Profile.md#mediawhitepoint), [`whitePoint`](./Profile.md#whitepoint), [`PCSWhitepoint`](./Profile.md#pcswhitepoint) - White point definitions

### `_cmsRGB`

**Sources**: [`def.js:343`](../def.js#L343), [`convert.js:87`](../convert.js#L87)

RGB color object with integer values.

```typescript
interface _cmsRGB {
  type: typeof eColourType.RGB; // Always eColourType.RGB (5)
  R: number; // Red component (0-255)
  G: number; // Green component (0-255)
  B: number; // Blue component (0-255)
}
```

**Used in:**

- Transform.md: Part of [`ColorObject`](./Common.md#colorobject) union type for color transformations

### `_cmsRGBf`

**Sources**: [`def.js:352`](../def.js#L352), [`convert.js:95`](../convert.js#L95)

RGB color object with floating-point values.

```typescript
interface _cmsRGBf {
  type: typeof eColourType.RGBf; // Always eColourType.RGBf (8)
  Rf: number; // Red component as float (0.0-1.0, can extend beyond for out-of-gamut)
  Gf: number; // Green component as float (0.0-1.0, can extend beyond for out-of-gamut)
  Bf: number; // Blue component as float (0.0-1.0, can extend beyond for out-of-gamut)
}
```

**Used in:**

- Transform.md: Part of [`ColorObject`](./Common.md#colorobject) union type for color transformations

### `_cmsCMYK`

**Sources**: [`def.js:309`](../def.js#L309), [`convert.js:35`](../convert.js#L35)

CMYK color object with percentage values.

```typescript
interface _cmsCMYK {
  type: typeof eColourType.CMYK; // Always eColourType.CMYK (6)
  C: number; // Cyan component (0-100)
  M: number; // Magenta component (0-100)
  Y: number; // Yellow component (0-100)
  K: number; // Black (Key) component (0-100)
}
```

### `_cmsCMYKf`

**Sources**: [`def.js:318`](../def.js#L318), [`convert.js:44`](../convert.js#L44)

CMYK color object with floating-point values.

```typescript
interface _cmsCMYKf {
  type: typeof eColourType.CMYKf; // Always eColourType.CMYKf (9)
  Cf: number; // Cyan component as float (0.0-1.0)
  Mf: number; // Magenta component as float (0.0-1.0)
  Yf: number; // Yellow component as float (0.0-1.0)
  Kf: number; // Black component as float (0.0-1.0)
}
```

### `_cmsLab`

**Sources**: [`def.js:327`](../def.js#L327), [`convert.js:62`](../convert.js#L62)

Lab color object with L*a*b* components.

```typescript
interface _cmsLab {
  type: typeof eColourType.Lab; // Always eColourType.Lab (2)
  L: number;                    // Lightness component (0.0-100.0)
  a: number;                    // Green-red color component (typically -128 to +127)
  b: number;                    // Blue-yellow color component (typically -128 to +127)
  whitePoint: _cmsWhitePoint;   // Reference white point for Lab calculations
}
```

### `_cmsLabD50`

**Sources**: [`def.js:335`](../def.js#L335), [`convert.js:71`](../convert.js#L71)

Lab color object without white point (assumes D50).

```typescript
interface _cmsLabD50 {
  L: number; // Lightness component (0.0-100.0)
  a: number; // Green-red color component (typically -128 to +127)
  b: number; // Blue-yellow color component (typically -128 to +127)
}
```

### `_cmsXYZ`

**Sources**: [`def.js:325`](../def.js#L325), [`convert.js:53`](../convert.js#L53)

XYZ color object with tristimulus values.

```typescript
interface _cmsXYZ {
  type: typeof eColourType.XYZ; // Always eColourType.XYZ (1)
  X: number;                    // X tristimulus value (typically 0.0-1.0)
  Y: number;                    // Y tristimulus value (luminance, typically 0.0-1.0)
  Z: number;                    // Z tristimulus value (typically 0.0-1.0)
  whitePoint?: _cmsWhitePoint;  // Optional reference white point
}
```

**Used in:**

- Profile.md: [`blackPoint`](./Profile.md#blackpoint) - Black point coordinates

### `_cmsLCH`

**Sources**: [`def.js:342`](../def.js#L342), [`convert.js:78`](../convert.js#L78)

LCH color object with Lightness, Chroma, and Hue components.

```typescript
interface _cmsLCH {
  type: typeof eColourType.LCH; // Always eColourType.LCH (3)
  L: number;                    // Lightness component (0.0-100.0)
  C: number;                    // Chroma component (0.0+, no upper limit)
  H: number;                    // Hue angle in degrees (0.0-360.0)
  whitePoint: _cmsWhitePoint;   // Reference white point for LCH calculations
}
```

### `_cmsGray`

**Sources**: [`def.js:375`](../def.js#L375), [`convert.js:22`](../convert.js#L22)

Grayscale color object.

```typescript
interface _cmsGray {
  type: typeof eColourType.Gray; // Color type from eColourType.Gray (4)
  G: number;                     // Grayscale value (0.0-1.0 or 0-255 depending on context)
}
```

### `_cmsDuo`

**Sources**: [`def.js:359`](../def.js#L359), [`convert.js:28`](../convert.js#L28)

Duo-tone color object for two-channel color spaces.

```typescript
interface _cmsDuo {
  type: typeof eColourType.Duo; // Always eColourType.Duo (12)
  a: number;                    // First color component (0.0-100)
  b: number;                    // Second color component (0.0-100)
}
```

### `_cmsDuof`

**Source**: [`def.js:366`](../def.js#L366)

Duo-tone color object with floating-point values.

```typescript
interface _cmsDuof {
  type: typeof eColourType.Duof; // Always eColourType.Duof (13)
  af: number;                    // First color component as float (0.0-1.0)
  bf: number;                    // Second color component as float (0.0-1.0)
}
```

### `_cmsxyY`

**Source**: [`convert.js:103`](../convert.js#L103)

xyY color object with chromaticity coordinates.

```typescript
interface _cmsxyY {
  type: typeof eColourType.xyY; // Always eColourType.xyY (14)
  x: number;                    // x chromaticity coordinate (0.0-1.0)
  y: number;                    // y chromaticity coordinate (0.0-1.0)
  Y: number;                    // Luminance component (0.0-1.0)
}
```

### `ColorObject`

**Source**: [`convert.js:112`](../convert.js#L112)

Union type for all supported color objects with optional white point.

```typescript
type ColorObject = (_cmsCMYK | _cmsCMYKf | _cmsRGB | _cmsRGBf | _cmsGray | _cmsLab | 
                   _cmsLCH | _cmsXYZ | _cmsxyY | _cmsDuo) & { whitePoint?: _cmsWhitePoint };
```

**Used in:**

- Transform.md: [`forward()`](./Transform.md#forwardcmscolor), [`transform()`](./Transform.md#transformcmscolor) - Input and output color parameters

## Utility Types

### `_Device`

**Source**: [`def.js:377`](../def.js#L377)

Array of n-Channel floats with device encoding.

```typescript
type _Device = number[]; // Array of n-Channel floats with a range of 0.0 to 1.0
```

### `_PCS`

**Source**: [`def.js:378`](../def.js#L378)

Array of n-Channel 16-bit integer data for Profile Connection Space.

```typescript
type _PCS = number[]; // Array of n-Channel 16bit integers data with a range of 0 to 65535
```

### `_PCSf`

**Source**: [`def.js:379`](../def.js#L379)

Array of n-Channel floats for Profile Connection Space.

```typescript
type _PCSf = number[]; // Array of n-Channel floats with a range of 0.0 to 1.0
```

### `stageEncoding`

**Source**: [`def.js:380`](../def.js#L380)

Numeric identifier for stage encoding type.

```typescript
type stageEncoding = number;
```

## Matrix and Profile Types

### `Matrix3x3`

**Source**: [`convert.js:116`](../convert.js#L116)

3x3 transformation matrix for color space conversions.

```typescript
interface Matrix3x3 {
  m00: number; // Matrix element at row 0, column 0
  m01: number; // Matrix element at row 0, column 1
  m02: number; // Matrix element at row 0, column 2
  m10: number; // Matrix element at row 1, column 0
  m11: number; // Matrix element at row 1, column 1
  m12: number; // Matrix element at row 1, column 2
  m20: number; // Matrix element at row 2, column 0
  m21: number; // Matrix element at row 2, column 1
  m22: number; // Matrix element at row 2, column 2
}
```

**Used in:**

- Profile.md: Referenced in [`RGBMatrix`](./Profile.md#rgbmatrix) for color space transformation matrices

### `RGBMatrix`

**Source**: [`convert.js:129`](../convert.js#L129)

RGB color space definition with transformation matrices and chromatic parameters.

```typescript
interface RGBMatrix {
  gamma?: number;         // Gamma value for tone reproduction curve
  cRx: number;           // Red colorant x chromaticity coordinate
  cRy: number;           // Red colorant y chromaticity coordinate  
  cGx: number;           // Green colorant x chromaticity coordinate
  cGy: number;           // Green colorant y chromaticity coordinate
  cBx: number;           // Blue colorant x chromaticity coordinate
  cBy: number;           // Blue colorant y chromaticity coordinate
  issRGB?: boolean;      // Whether this uses sRGB gamma curve
  matrixV4?: Matrix3x3;  // RGB to XYZ transformation matrix
  matrixInv?: Matrix3x3; // XYZ to RGB transformation matrix
  XYZMatrix?: Matrix3x3; // Direct XYZ transformation matrix
  XYZMatrixInv?: Matrix3x3; // Inverse XYZ transformation matrix
}
```

**Used in:**

- Profile.md: [`RGBMatrix`](./Profile.md#rgbmatrix), [`createRGBMatrix()`](./Profile.md#creatergbmatrix) - RGB matrix profile structure and creation

### `RGBProfile`

**Source**: [`convert.js:145`](../convert.js#L145)

Complete RGB profile definition with colorant data.

```typescript
interface RGBProfile {
  mediaWhitePoint: _cmsWhitePoint; // Media white point for the RGB profile
  RGBMatrix: RGBMatrix;            // RGB transformation matrices and parameters
  rgb: {                           // RGB colorant data
    rXYZ: _cmsXYZ;                // Red colorant XYZ values
    gXYZ: _cmsXYZ;                // Green colorant XYZ values
    bXYZ: _cmsXYZ;                // Blue colorant XYZ values
  };
}
```

## LUT and Pipeline Types

### `LUT`

**Source**: [`decode.js:12`](../decode.js#L12)

Lookup table structure for color transformations.

```typescript
interface LUT {
  version?: number;                     // LUT version number
  type?: string;                        // LUT type identifier
  encoding?: 'number' | 'base64';       // Data encoding format
  precision?: number;                   // Precision for number encoding
  inputScale: number;                   // Input value scaling factor
  outputScale: number;                  // Output value scaling factor
  inputChannels: number;                // Number of input color channels
  outputChannels: number;               // Number of output color channels
  inputTableEntries?: number;           // Number of input table entries
  outputTableEntries?: number;          // Number of output table entries
  gridPoints?: number[];                // Grid points per dimension
  matrix?: ReturnType<matrixV4 | matrixV2> | false; // Transformation matrix
  inputCurve?: CurveV2;                // Input tone reproduction curves
  outputCurve?: CurveV2;               // Output tone reproduction curves
  CLUT?: Float64Array | Uint16Array | Uint8Array | false; // Color lookup table data
  aCurves?: ReturnType<curves> | false; // A-curves for advanced processing
  bCurves?: ReturnType<curves> | false; // B-curves for advanced processing
  mCurves?: ReturnType<curves> | false; // M-curves for advanced processing
  elements?: Array<{                    // LUT elements structure
    sig: 'cvst' | 'matf' | 'clut';     // Element signature
  }>;
  chain?: (Profile | ProfileObject | eIntent)[]; // Profile chain for multi-stage
  g1: number;                          // Grid point 1
  g2: number;                          // Grid point 2
  g3: number;                          // Grid point 3
  g4?: number;                         // Grid point 4 (for 4D LUTs)
  go0: number;                         // Grid output 0
  go1: number;                         // Grid output 1
  go2: number;                         // Grid output 2
  go3?: number;                        // Grid output 3 (for 4-channel output)
}
```

**Used in:**

- Transform.md: [`getLut()`](./Transform.md#getlutprecision), [`getLut16()`](./Transform.md#getlut16), [`getLut8()`](./Transform.md#getlut8), [`setLut()`](./Transform.md#setlutlut), [`prebuiltLUT`](./Transform.md#prebuiltlut) - LUT management and optimization

### `CurveV2`

**Source**: [`decode.js:44`](../decode.js#L44)

ICC v2 curve structure for tone reproduction.

```typescript
interface CurveV2 {
  channels: number;                 // Number of color channels
  entries: number;                  // Number of curve entries
  table: Uint8Array | Uint16Array; // Curve data table
  tablef: Float64Array;            // Floating-point curve data
  outputScale: number;             // Output scaling factor
}
```

### `CurveV4`

**Source**: [`decode.js:53`](../decode.js#L53)

ICC v4 curve structure (return type of curve function).

```typescript
type CurveV4 = ReturnType<curve>; // Dynamic type based on curve function implementation
```

### `_Stage`

**Sources**: [`def.js:382`](../def.js#L382), [`transform.js:107`](../transform.js#L107)

Individual stage in a color transformation pipeline.

```typescript
interface _Stage {
  stageName: string;                     // Stage name/identifier
  type?: string;                        // Stage type (e.g., 'matrix', 'lut', 'adaptation')
  fn?: Function;                        // Transform function to execute
  data?: object;                        // Stage-specific data
  description?: string;                 // Human-readable description
  funct?: function;                     // Custom function for this stage
  stageData: object;                    // Custom data for this stage
  inputEncoding?: encoding | false;     // Input encoding type
  outputEncoding?: encoding | false;    // Output encoding type
  debugFormat?: string;                 // Debug format string
  optimized?: boolean;                  // Whether the stage is optimized
}
```

**Used in:**

- Transform.md: [`pipeline`](./Transform.md#pipeline), [`_Stage`](./Transform.md#_stage) - Pipeline stage structure and implementation

## Constants

### `illuminant`

**Source**: [`def.js:217`](../def.js#L217)

Standard illuminant definitions with XYZ tristimulus values.

```typescript
const illuminant: {
  readonly a: _cmsWhitePoint;   // Standard illuminant A (incandescent tungsten)
  readonly b: _cmsWhitePoint;   // Standard illuminant B (noon sunlight)
  readonly c: _cmsWhitePoint;   // Standard illuminant C (daylight)
  readonly d50: _cmsWhitePoint; // Standard illuminant D50 (horizon daylight)
  readonly d55: _cmsWhitePoint; // Standard illuminant D55 (mid-morning daylight)
  readonly d65: _cmsWhitePoint; // Standard illuminant D65 (noon daylight)
  readonly d75: _cmsWhitePoint; // Standard illuminant D75 (north sky daylight)
  readonly e: _cmsWhitePoint;   // Equal energy illuminant
  readonly f2: _cmsWhitePoint;  // Fluorescent F2 (cool white fluorescent)
  readonly f7: _cmsWhitePoint;  // Fluorescent F7 (broad-band daylight fluorescent)
  readonly f11: _cmsWhitePoint; // Fluorescent F11 (narrow-band white fluorescent)
};
```

### `encodingStr`

**Source**: [`def.js:263`](../def.js#L263)

String representations of encoding types for debugging and logging.

```typescript
const encodingStr: readonly string[] = [
  'device', 'PCSv2', 'PCSv4', 'PCSXYZ', 'LabD50', 
  'cmsLab', 'cmsRGB', 'cmsCMYK', 'cmsXYZ'
];
```

### `u1Fixed15NumberMax`

**Source**: [`def.js:284`](../def.js#L284)

Maximum value for u1Fixed15Number format used in ICC profiles.

```typescript
const u1Fixed15NumberMax: number = 1 + 32767 / 32768; // ≈ 1.999969482421875
```

## Utility Functions

### `eProfileTypeToString`

**Source**: [`def.js:77`](../def.js#L77)

Converts a profile type enum value to human-readable string.

```typescript
function eProfileTypeToString(type: eProfileType): string;
```

### `intent2String`

**Source**: [`def.js:122`](../def.js#L122)

Converts rendering intent enum value to human-readable string.

```typescript
function intent2String(intent: number): 'Perceptual' | 'Relative' | 'Saturation' | 'Absolute' | 'unknown';
```

**Used in:**

- Transform.md: [`intent2String()`](./Transform.md#intent2stringintent) - Utility method for intent to string conversion

### `cgatsIntentString`

**Source**: [`def.js:127`](../def.js#L127)

Converts rendering intent to CGATS-compliant string format.

```typescript
function cgatsIntentString(intent: eIntent): string;
```

### `roundN`

**Source**: [`def.js:139`](../def.js#L139)

Rounds a number to specified decimal places.

```typescript
function roundN(n: number, places: number): number;
```

## Array Conversion Utilities

### `uint8ArrayToBase64`

**Source**: [`def.js:147`](../def.js#L147)

Converts a Uint8Array to a base64 string.

```typescript
function uint8ArrayToBase64(uint8Array: Uint8Array): string;
```

### `uint16ArrayToBase64`

**Source**: [`def.js:160`](../def.js#L160)

Converts a Uint16Array to a base64 string.

```typescript
function uint16ArrayToBase64(uint16Array: Uint16Array): string;
```

### `base64ToUint16Array`

**Source**: [`def.js:169`](../def.js#L169)

Converts a base64 string to a Uint16Array.

```typescript
function base64ToUint16Array(base64String: string): Uint16Array;
```

### `base64ToUint8Array`

**Source**: [`def.js:184`](../def.js#L184)

Converts a base64 string to a Uint8Array.

```typescript
function base64ToUint8Array(base64String: string): Uint8Array;
```
