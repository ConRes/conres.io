# `Profile` Class Documentation

The [`Profile`](#profile-class) class handles loading and management of ICC color profiles from various sources including binary data, files, URLs, base64 data, and virtual profiles.

## Table of Contents

- [`Profile` Class Documentation](#profile-class-documentation)
  - [Table of Contents](#table-of-contents)
  - [`Profile` Class](#profile-class)
    - [Overview](#overview)
      - [Supported Sources](#supported-sources)
    - [Constructor](#constructor)
      - [`Profile(dataOrUrl?, afterLoad?)`](#profiledataorurl-afterload)
    - [Properties](#properties)
      - [Loading State Properties](#loading-state-properties)
        - [`loaded`](#loaded)
        - [`loadError`](#loaderror)
      - [Profile Identification Properties](#profile-identification-properties)
        - [`type`](#type)
        - [`name`](#name)
        - [`description`](#description)
        - [`tagDescription`](#tagdescription)
        - [`copyright`](#copyright)
        - [`technology`](#technology)
      - [Profile Structure Properties](#profile-structure-properties)
        - [`header`](#header)
        - [`intent`](#intent)
        - [`tags`](#tags)
        - [`version`](#version)
      - [Color Space Properties](#color-space-properties)
        - [`pcs`](#pcs)
        - [`outputChannels`](#outputchannels)
      - [White Point and Illuminant Properties](#white-point-and-illuminant-properties)
        - [`mediaWhitePoint`](#mediawhitepoint)
        - [`whitePoint`](#whitepoint)
        - [`blackPoint`](#blackpoint)
        - [`PCSWhitepoint`](#pcswhitepoint)
      - [Encoding Properties](#encoding-properties)
        - [`PCSEncode`](#pcsencode)
        - [`PCSDecode`](#pcsdecode)
        - [`PCS8BitScale`](#pcs8bitscale)
      - [Viewing Conditions Properties](#viewing-conditions-properties)
        - [`viewingConditions`](#viewingconditions)
        - [`characterizationTarget`](#characterizationtarget)
        - [`luminance`](#luminance)
        - [`chromaticAdaptation`](#chromaticadaptation)
      - [Profile-Specific Data Properties](#profile-specific-data-properties)
        - [`Gray`](#gray)
        - [`rgb`](#rgb)
        - [`RGBMatrix`](#rgbmatrix)
      - [LUT Properties](#lut-properties)
        - [`A2B`](#a2b)
        - [`B2A`](#b2a)
        - [`B2D`](#b2d)
        - [`D2B`](#d2b)
      - [Adaptation Properties](#adaptation-properties)
        - [`absoluteAdaptationIn`](#absoluteadaptationin)
        - [`absoluteAdaptationOut`](#absoluteadaptationout)
        - [`virutalProfileUsesD50AdaptedPrimaries`](#virutalprofileusesd50adaptedprimaries)
      - [Error and Debugging Properties](#error-and-debugging-properties)
        - [`lastError`](#lasterror)
        - [`unsuportedTags`](#unsuportedtags)
    - [Public Methods](#public-methods)
      - [Loading Methods](#loading-methods)
        - [`loadPromise(dataOrUrl)`](#loadpromisedataorurl)
        - [`load(dataOrUrl, afterLoad?)`](#loaddataorurl-afterload)
        - [`loadBinary(binary, afterLoad?, searchForProfile?)`](#loadbinarybinary-afterload-searchforprofile)
        - [`loadFile(filename, afterLoad?)`](#loadfilefilename-afterload)
        - [`loadBase64(base64, afterLoad?)`](#loadbase64base64-afterload)
        - [`loadURL(url, afterLoad?)`](#loadurlurl-afterload)
        - [`loadVirtualProfile(name, afterLoad?)`](#loadvirtualprofilename-afterload)
      - [Profile Creation Methods](#profile-creation-methods)
        - [`createVirtualProfile(name)`](#createvirtualprofilename)
        - [`createRGBMatrix()`](#creatergbmatrix)
      - [File I/O Methods](#file-io-methods)
        - [`readBinaryFile(specifier)`](#readbinaryfilespecifier)
      - [Profile Parsing Methods](#profile-parsing-methods)
        - [`readICCProfile(data, searchForProfile?)`](#readiccprofiledata-searchforprofile)
        - [`decodeHeader(binary)`](#decodeheaderbinary)
        - [`decodeTags(binary)`](#decodetagsbinary)
        - [`decodeFile(binary)`](#decodefilebinary)
        - [`techSignatureString(sig)`](#techsignaturestringsig)
    - [Virtual Profiles](#virtual-profiles)
      - [Supported Virtual Profiles](#supported-virtual-profiles)
      - [Virtual Profile Characteristics](#virtual-profile-characteristics)
    - [Usage Examples](#usage-examples)
      - [Loading Different Profile Types](#loading-different-profile-types)
      - [Profile Inspection](#profile-inspection)
      - [Error Handling](#error-handling)
      - [Profile Comparison](#profile-comparison)
      - [Custom Virtual Profile Creation](#custom-virtual-profile-creation)

---

## `Profile` Class

### Overview

**Source**: [`profile.js:28`](../profile.js#L28)

The [`Profile`](#profile-class) class provides comprehensive ICC profile support:

1. Decodes ICC Profile from binary Uint8Array, URL, or base64 encoded string
2. Creates virtual profiles in memory for common color spaces
3. Supports ICC Profile version 2 and 4
4. Supports RGB, Gray, Lab and CMYK profiles
5. RGB Profiles can be Matrix based or LUT based

#### Supported Sources

- **Uint8Array**: Binary ICC profile data
- **String starting with '*'**: Virtual profile name (e.g., `'*sRGB'`)
- **String starting with 'file:'**: Local file path
- **String starting with 'data:'**: Base64 encoded data
- **String (other)**: HTTP URL

### Constructor

#### `Profile(dataOrUrl?, afterLoad?)`

**Source**: [`profile.js:47`](../profile.js#L47)

Creates a new [`Profile`](#profile-class) instance and optionally loads data.

```typescript
constructor(
  dataOrUrl?: string | Uint8Array, 
  afterLoad?: (profile: Profile) => void
)
```

**Parameters:**

- `dataOrUrl` - Data source to load from (see supported sources above)
- `afterLoad` - Callback function executed after loading completes

**Example:**

```javascript
// Load from file
const profile1 = new Profile('file:./cmyk-profile.icc', (profile) => {
  console.log('Profile loaded:', profile.name);
});

// Load virtual profile
const profile2 = new Profile('*sRGB');

// Load from binary data
const binaryData = new Uint8Array(profileBytes);
const profile3 = new Profile(binaryData);
```

### Properties

#### Loading State Properties

##### `loaded`

**Source**: [`profile.js:56`](../profile.js#L56)

```typescript
loaded: boolean = false
```

Profile loading state - true when profile is successfully loaded.

##### `loadError`

**Source**: [`profile.js:59`](../profile.js#L59)

```typescript
loadError: boolean = false
```

Profile loading error state - true when an error occurred during loading.

#### Profile Identification Properties

##### `type`

**Source**: [`profile.js:62`](../profile.js#L62)

```typescript
type: number = 0
```

Profile type from [`eProfileType`](./Common.md#eprofiletype) enum.

##### `name`

**Source**: [`profile.js:65`](../profile.js#L65)

```typescript
name: string = ''
```

Profile name extracted from ICC profile data.

##### `description`

**Source**: [`profile.js:74`](../profile.js#L74)

```typescript
description: string = ''
```

Profile description text.

##### `tagDescription`

**Source**: [`profile.js:77`](../profile.js#L77)

```typescript
tagDescription: string = ''
```

Tag description information.

##### `copyright`

**Source**: [`profile.js:80`](../profile.js#L80)

```typescript
copyright: string = ''
```

Copyright information.

##### `technology`

**Source**: [`profile.js:83`](../profile.js#L83)

```typescript
technology: string = ''
```

Technology information.

#### Profile Structure Properties

##### `header`

**Source**: [`profile.js:68`](../profile.js#L68)

```typescript
header: object = {}
```

ICC profile header information containing version, class, space, etc.

##### `intent`

**Source**: [`profile.js:71`](../profile.js#L71)

```typescript
intent: number = 0
```

Default rendering intent for this profile.

##### `tags`

**Source**: [`profile.js:75`](../profile.js#L75)

```typescript
tags: any[] = []
```

Array of ICC profile tags.

##### `version`

**Source**: [`profile.js:126`](../profile.js#L126)

```typescript
version: number = 0
```

ICC profile version.

#### Color Space Properties

##### `pcs`

**Source**: [`profile.js:129`](../profile.js#L129)

```typescript
pcs: 'LAB' | 'XYZ' | false = false
```

Whether this uses Profile Connection Space and which type.

##### `outputChannels`

**Source**: [`profile.js:168`](../profile.js#L168)

```typescript
outputChannels: number = 0
```

Number of output channels in the profile.

#### White Point and Illuminant Properties

##### `mediaWhitePoint`

**Source**: [`profile.js:89`](../profile.js#L89)

```typescript
mediaWhitePoint: _cmsWhitePoint | null = null
```

Media white point in XYZ coordinates. See [`_cmsWhitePoint`](./Common.md#_cmswhitepoint).

##### `whitePoint`

**Source**: [`profile.js:138`](../profile.js#L138)

```typescript
whitePoint: _cmsWhitePoint | null = null
```

White point in XYZ coordinates.

##### `blackPoint`

**Source**: [`profile.js:135`](../profile.js#L135)

```typescript
blackPoint: _cmsXYZ | null = null
```

Black point in XYZ coordinates. See [`_cmsXYZ`](./Common.md#_cmsxyz).

##### `PCSWhitepoint`

**Source**: [`profile.js:165`](../profile.js#L165)

```typescript
PCSWhitepoint: _cmsWhitePoint
```

Profile Connection Space white point (default D50).

#### Encoding Properties

##### `PCSEncode`

**Source**: [`profile.js:92`](../profile.js#L92)

```typescript
PCSEncode: number = 2
```

PCS encoding type for encoding operations.

##### `PCSDecode`

**Source**: [`profile.js:95`](../profile.js#L95)

```typescript
PCSDecode: number = 2
```

PCS decoding type for decoding operations.

##### `PCS8BitScale`

**Source**: [`profile.js:98`](../profile.js#L98)

```typescript
PCS8BitScale: number = 0
```

8-bit PCS scaling factor.

#### Viewing Conditions Properties

##### `viewingConditions`

**Source**: [`profile.js:86`](../profile.js#L86)

```typescript
viewingConditions: ReturnType<decode['viewingConditions'] | decode['text']> | '' = ''
```

Viewing conditions description.

##### `characterizationTarget`

**Source**: [`profile.js:101`](../profile.js#L101)

```typescript
characterizationTarget: ReturnType<decode['text']> | '' = ''
```

Characterization target information.

##### `luminance`

**Source**: [`profile.js:141`](../profile.js#L141)

```typescript
luminance: any = null
```

Luminance information.

##### `chromaticAdaptation`

**Source**: [`profile.js:144`](../profile.js#L144)

```typescript
chromaticAdaptation: any = null
```

Chromatic adaptation matrix.

#### Profile-Specific Data Properties

##### `Gray`

**Source**: [`profile.js:150`](../profile.js#L150)

```typescript
Gray: {
  kTRC: any;
  inv_kTRC: any;
}
```

Grayscale profile data containing tone reproduction curves.

##### `rgb`

**Source**: [`profile.js:156`](../profile.js#L156)

```typescript
rgb: {
  rTRC: any;
  rTRCInv: any;
  gTRC: any;
  gTRCInv: any;
  bTRC: any;
  bTRCInv: any;
  rXYZ: any;
  gXYZ: any;
  bXYZ: any;
}
```

RGB profile data containing tone reproduction curves and colorant XYZ values.

##### `RGBMatrix`

**Source**: [`profile.js:170`](../profile.js#L170)

```typescript
RGBMatrix: import('./convert.js').RGBMatrix
```

RGB matrix profile data. See [`RGBMatrix`](./Common.md#rgbmatrix).

#### LUT Properties

##### `A2B`

**Source**: [`profile.js:190`](../profile.js#L190)

```typescript
A2B: [decode.LUT | null, decode.LUT | null, decode.LUT | null]
```

A2B (AToB) lookup tables for device to PCS conversion. Array indexed by rendering intent.

##### `B2A`

**Source**: [`profile.js:195`](../profile.js#L195)

```typescript
B2A: [decode.LUT | null, decode.LUT | null, decode.LUT | null]
```

B2A (BToA) lookup tables for PCS to device conversion. Array indexed by rendering intent.

##### `B2D`

**Source**: [`profile.js:178`](../profile.js#L178)

```typescript
B2D: [decode.LUT | null, decode.LUT | null, decode.LUT | null, decode.LUT | null]
```

Floating-point LUT tables (B to device) - not implemented yet.

##### `D2B`

**Source**: [`profile.js:184`](../profile.js#L184)

```typescript
D2B: [decode.LUT | null, decode.LUT | null, decode.LUT | null, decode.LUT | null]
```

Floating-point LUT tables (device to B) - not implemented yet.

#### Adaptation Properties

##### `absoluteAdaptationIn`

**Source**: [`profile.js:198`](../profile.js#L198)

```typescript
absoluteAdaptationIn: {
  Xa: number;
  Ya: number;
  Za: number;
}
```

Absolute colorimetric adaptation factors for input.

##### `absoluteAdaptationOut`

**Source**: [`profile.js:204`](../profile.js#L204)

```typescript
absoluteAdaptationOut: {
  Xa: number;
  Ya: number;
  Za: number;
}
```

Absolute colorimetric adaptation factors for output.

##### `virutalProfileUsesD50AdaptedPrimaries`

**Source**: [`profile.js:147`](../profile.js#L147)

```typescript
virutalProfileUsesD50AdaptedPrimaries: boolean = true
```

Whether virtual profile uses D50 adapted primaries.

#### Error and Debugging Properties

##### `lastError`

**Source**: [`profile.js:172`](../profile.js#L172)

```typescript
lastError: { err: number; text: string; } = { err: 0, text: 'No Error' }
```

Last error information.

##### `unsuportedTags`

**Source**: [`profile.js:149`](../profile.js#L149)

```typescript
unsuportedTags: any[] = []
```

Array of unsupported ICC tags.

### Public Methods

#### Loading Methods

##### `loadPromise(dataOrUrl)`

**Source**: [`profile.js:217`](../profile.js#L217)

Loads profile data asynchronously and returns a Promise.

```typescript
loadPromise(dataOrUrl: string | Uint8Array): Promise<Profile>
```

**Parameters:**

- `dataOrUrl` - Data source to load from

**Returns:**
Promise that resolves with the loaded profile.

**Example:**

```javascript
const profile = new Profile();
profile.loadPromise('*sRGB')
  .then(loadedProfile => {
    console.log('Profile loaded:', loadedProfile.name);
  })
  .catch(error => {
    console.error('Failed to load profile:', error);
  });
```

##### `load(dataOrUrl, afterLoad?)`

**Source**: [`profile.js:228`](../profile.js#L228)

Generic profile loader that detects data type and calls appropriate loader.

```typescript
load(
  dataOrUrl: string | Uint8Array, 
  afterLoad?: (profile: Profile) => void
): void
```

**Parameters:**

- `dataOrUrl` - Data source (see constructor documentation for formats)
- `afterLoad` - Optional callback function executed after loading

**Description:**
Automatically detects the data type and calls the appropriate specific loader method.

##### `loadBinary(binary, afterLoad?, searchForProfile?)`

**Source**: [`profile.js:240`](../profile.js#L240)

Loads ICC profile from binary data (Uint8Array).

```typescript
loadBinary(
  binary: Uint8Array, 
  afterLoad?: (profile: Profile) => void, 
  searchForProfile?: boolean = true
): void
```

**Parameters:**

- `binary` - Binary ICC profile data
- `afterLoad` - Optional callback function executed after loading
- `searchForProfile` - Whether to search for embedded profiles

**Example:**

```javascript
const fileData = await fs.readFile('profile.icc');
const binary = new Uint8Array(fileData);
profile.loadBinary(binary);
```

##### `loadFile(filename, afterLoad?)`

**Source**: [`profile.js:252`](../profile.js#L252)

Loads ICC profile from a local file (Node.js only).

```typescript
async loadFile(
  filename: string, 
  afterLoad?: (profile: Profile) => void
): Promise<void>
```

**Parameters:**

- `filename` - File path, optionally prefixed with 'file:'
- `afterLoad` - Optional callback function executed after loading

**Returns:**
Promise that resolves when loading completes.

**Example:**

```javascript
await profile.loadFile('/path/to/profile.icc');
// or
await profile.loadFile('file:///path/to/profile.icc');
```

##### `loadBase64(base64, afterLoad?)`

**Source**: [`profile.js:271`](../profile.js#L271)

Loads ICC profile from base64 encoded data.

```typescript
loadBase64(
  base64: string, 
  afterLoad?: (profile: Profile) => void
): void
```

**Parameters:**

- `base64` - Base64 encoded ICC profile data, optionally prefixed with 'data:'
- `afterLoad` - Optional callback function executed after loading

**Example:**

```javascript
const base64Data = 'data:AQIDBA...'; // base64 encoded profile
profile.loadBase64(base64Data);
```

##### `loadURL(url, afterLoad?)`

**Source**: [`profile.js:283`](../profile.js#L283)

Loads ICC profile from a URL.

```typescript
async loadURL(
  url: string, 
  afterLoad?: (profile: Profile) => void
): Promise<void>
```

**Parameters:**

- `url` - HTTP URL to the ICC profile
- `afterLoad` - Optional callback function executed after loading

**Example:**

```javascript
await profile.loadURL('https://example.com/profiles/srgb.icc');
```

##### `loadVirtualProfile(name, afterLoad?)`

**Source**: [`profile.js:297`](../profile.js#L297)

Loads a virtual profile by name.

```typescript
loadVirtualProfile(
  name: string, 
  afterLoad?: (profile: Profile) => void
): void
```

**Parameters:**

- `name` - Virtual profile name (with or without '*' prefix)
- `afterLoad` - Optional callback function executed after loading

**Example:**

```javascript
profile.loadVirtualProfile('sRGB'); // or '*sRGB'
```

#### Profile Creation Methods

##### `createVirtualProfile(name)`

**Source**: [`profile.js:310`](../profile.js#L310)

Creates a virtual profile in memory for common color spaces.

```typescript
createVirtualProfile(name: string): boolean
```

**Parameters:**

- `name` - Virtual profile name (without '*' prefix)

**Returns:**
true if the virtual profile was successfully created.

**Description:**
Virtual profiles are created as ICC v4 profiles with appropriate colorimetric data for common working spaces.

##### `createRGBMatrix()`

**Source**: [`profile.js:1032`](../profile.js#L1032)

Creates an RGBMatrix representation of the profile.

```typescript
createRGBMatrix(): void
```

**Description:**
Converts the loaded ICC profile data into an [`RGBMatrix`](./Common.md#rgbmatrix) structure for matrix-based transformations.

#### File I/O Methods

##### `readBinaryFile(specifier)`

**Source**: [`profile.js:325`](../profile.js#L325)

Reads binary data from a file (platform-specific implementation).

```typescript
async readBinaryFile(specifier: string): Promise<Uint8Array>
```

**Parameters:**

- `specifier` - File path or identifier

**Returns:**
Promise resolving to binary file data.

**Description:**
Handles file reading across different environments (Node.js, CEP, browser).

#### Profile Parsing Methods

##### `readICCProfile(data, searchForProfile?)`

**Source**: [`profile.js:349`](../profile.js#L349)

Parses ICC profile from binary data.

```typescript
readICCProfile(data: Uint8Array, searchForProfile?: boolean): boolean
```

**Parameters:**

- `data` - Binary ICC profile data
- `searchForProfile` - Whether to search for embedded profiles

**Returns:**
true if parsing was successful.

**Description:**
Core parsing method that extracts all ICC profile information from binary data.

##### `decodeHeader(binary)`

**Source**: [`profile.js:1047`](../profile.js#L1047)

Decodes ICC profile header information.

```typescript
decodeHeader(binary: Uint8Array): any
```

**Parameters:**

- `binary` - Binary ICC profile data

**Returns:**
Decoded header object.

##### `decodeTags(binary)`

**Source**: [`profile.js:1051`](../profile.js#L1051)

Decodes ICC profile tags.

```typescript
decodeTags(binary: Uint8Array): any
```

**Parameters:**

- `binary` - Binary ICC profile data

**Returns:**
Array of decoded tags.

##### `decodeFile(binary)`

**Source**: [`profile.js:1055`](../profile.js#L1055)

Decodes complete ICC profile file.

```typescript
decodeFile(binary: Uint8Array): boolean
```

**Parameters:**

- `binary` - Binary ICC profile data

**Returns:**
true if decoding was successful.

##### `techSignatureString(sig)`

**Source**: [`profile.js:1059`](../profile.js#L1059)

Converts technology signature to human-readable string.

```typescript
techSignatureString(sig: any): string
```

**Parameters:**

- `sig` - Technology signature

**Returns:**
Human-readable technology description.

### Virtual Profiles

#### Supported Virtual Profiles

The [`Profile`](#profile-class) class supports the following virtual profiles:

- **`'*sRGB'`** - sRGB color space (most common)
- **`'*AdobeRGB'`** - Adobe RGB (1998)
- **`'*AppleRGB'`** - Apple RGB
- **`'*ColorMatchRGB'`** - ColorMatch RGB
- **`'*ProPhotoRGB'`** - ProPhoto RGB
- **`'*Lab'`** - Lab D50
- **`'*LabD50'`** - Lab D50 (same as*Lab)
- **`'*LabD65'`** - Lab D65
- **`'*XYZ'`** - XYZ color space

#### Virtual Profile Characteristics

Virtual profiles are created as ICC v4 profiles with:

- Appropriate gamma values for each color space
- Standard illuminant (D50 or D65 as appropriate)
- Calculated transformation matrices
- Standard colorant coordinates

**Example working space parameters:**

| Color Space  | Gamma | White Point | Red xy         | Green xy       | Blue xy        |
| ------------ | ----- | ----------- | -------------- | -------------- | -------------- |
| sRGB         | ≈2.2  | D65         | 0.6400, 0.3300 | 0.3000, 0.6000 | 0.1500, 0.0600 |
| Adobe RGB    | 2.2   | D65         | 0.6400, 0.3300 | 0.2100, 0.7100 | 0.1500, 0.0600 |
| ProPhoto RGB | 1.8   | D50         | 0.7347, 0.2653 | 0.1596, 0.8404 | 0.0366, 0.0001 |

### Usage Examples

#### Loading Different Profile Types

```javascript
import { Profile } from './js-color-engine/main.js';

// Virtual profile (immediate)
const srgb = new Profile('*sRGB');
console.log('sRGB loaded:', srgb.loaded); // true

// Binary file (async)
const cmykProfile = new Profile();
await cmykProfile.loadFile('./GRACoL2006_Coated1v2.icc');

// From URL (async)
const webProfile = new Profile();
await webProfile.loadURL('https://example.com/profile.icc');

// From base64 data
const base64Profile = new Profile('data:AQIDBA...');
```

#### Profile Inspection

```javascript
const profile = new Profile('*sRGB');

console.log('Profile info:');
console.log('- Name:', profile.name);
console.log('- Type:', profile.type);
console.log('- Description:', profile.description);
console.log('- Output channels:', profile.outputChannels);
console.log('- PCS:', profile.pcs);
console.log('- Version:', profile.version);

// White point information
if (profile.mediaWhitePoint) {
  console.log('Media white point:', profile.mediaWhitePoint);
  console.log('- Description:', profile.mediaWhitePoint.desc);
  console.log('- XYZ:', profile.mediaWhitePoint.X, profile.mediaWhitePoint.Y, profile.mediaWhitePoint.Z);
}

// RGB-specific data
if (profile.rgb.rXYZ) {
  console.log('RGB colorants:');
  console.log('- Red XYZ:', profile.rgb.rXYZ);
  console.log('- Green XYZ:', profile.rgb.gXYZ);
  console.log('- Blue XYZ:', profile.rgb.bXYZ);
}
```

#### Error Handling

```javascript
const profile = new Profile();

// Synchronous loading with error checking
profile.load('invalid-profile.icc', (loadedProfile) => {
  if (loadedProfile.loadError) {
    console.error('Failed to load profile:', loadedProfile.lastError.text);
  } else {
    console.log('Profile loaded successfully');
  }
});

// Asynchronous loading with Promise
try {
  await profile.loadPromise('./profile.icc');
  console.log('Profile loaded successfully');
} catch (error) {
  console.error('Failed to load profile:', error);
}
```

#### Profile Comparison

```javascript
const srgb = new Profile('*sRGB');
const adobeRgb = new Profile('*AdobeRGB');

// Compare white points
console.log('sRGB white point:', srgb.mediaWhitePoint?.desc);
console.log('Adobe RGB white point:', adobeRgb.mediaWhitePoint?.desc);

// Compare gamuts (via colorant coordinates)
console.log('sRGB red xy:', srgb.RGBMatrix.cRx, srgb.RGBMatrix.cRy);
console.log('Adobe RGB red xy:', adobeRgb.RGBMatrix.cRx, adobeRgb.RGBMatrix.cRy);
```

#### Custom Virtual Profile Creation

```javascript
// Create a custom virtual profile
const customProfile = new Profile();
customProfile.createVirtualProfile('sRGB'); // Base on sRGB

// Modify parameters as needed
customProfile.RGBMatrix.gamma = 2.4; // Custom gamma
customProfile.name = 'Custom sRGB 2.4';
customProfile.description = 'sRGB with gamma 2.4';
```
