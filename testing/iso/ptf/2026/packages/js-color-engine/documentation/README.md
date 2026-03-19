# JS-Color-Engine API Documentation

TypeDoc-style documentation for the JS-Color-Engine color management library.

## Overview

The JS-Color-Engine is a JavaScript implementation of professional color management that mirrors the architecture and concepts of Little-CMS. It provides ICC profile-based color transformations with support for RGB, CMYK, Lab, and grayscale color spaces.

## Table of Contents

- [JS-Color-Engine API Documentation](#js-color-engine-api-documentation)
  - [Overview](#overview)
  - [Table of Contents](#table-of-contents)
  - [Main Classes](#main-classes)
    - [Transform](#transform)
    - [Profile](#profile)
  - [Shared Types and Definitions](#shared-types-and-definitions)
    - [Common](#common)
  - [Quick Start](#quick-start)
  - [Architecture](#architecture)
  - [Key Features](#key-features)
  - [Color Management Concepts](#color-management-concepts)
  - [Migration Path](#migration-path)

## Main Classes

### [Transform](./Transform.md)

The primary interface for color transformations between different color spaces using ICC profiles. Features include:

- Single and multi-stage transformations
- Custom stage insertion capabilities
- Multiple data format support
- LUT optimization for performance
- Pipeline debugging tools

### [Profile](./Profile.md)

ICC color profile loading and management class that supports:

- Loading from files, URLs, binary data, and base64
- Virtual profile generation for common color spaces
- ICC v2 and v4 profile support
- RGB, CMYK, Lab, and grayscale profiles

## Shared Types and Definitions

### [Common](./Common.md)

Comprehensive reference for shared types, enumerations, and interfaces used throughout the system:

- Color type enumerations (`eColourType`, `eProfileType`, `eIntent`)
- Color object interfaces (`_cmsRGB`, `_cmsLab`, `_cmsCMYK`, etc.)
- Matrix and transformation types
- LUT and pipeline structures
- Utility functions and constants

## Quick Start

```javascript
import { Transform, Profile } from './js-color-engine/main.js';
import { eIntent } from './js-color-engine/def.js';

// Create a basic sRGB to CMYK transform
const transform = new Transform({ useBPC: true });
transform.create('*sRGB', './cmyk-profile.icc', eIntent.perceptual);

// Transform a color
const inputColor = { type: eColourType.RGBf, Rf: 1.0, Gf: 0.5, Bf: 0.2 };
const outputColor = transform.forward(inputColor);
```

## Architecture

The library uses a pipeline-based architecture that mirrors Little-CMS:

- **Stages**: Individual transformation steps (matrix operations, LUTs, curves)
- **Pipeline**: Sequence of stages for complete transformations
- **PCS**: Profile Connection Space for device-independent color representation
- **Optimization**: Automatic pipeline optimization to remove redundant stages

## Key Features

- **ICC Profile Support**: Full support for matrix and LUT-based profiles
- **Virtual Profiles**: Built-in common color spaces (sRGB, Adobe RGB, Lab, etc.)
- **Rendering Intents**: Perceptual, relative, saturation, and absolute colorimetric
- **Black Point Compensation**: Automatic shadow detail preservation
- **Gray Component Replacement**: Experimental CMYK ink optimization
- **Multi-format Support**: Object, float, integer, and device array formats
- **Performance Optimization**: LUT caching and pipeline optimization

## Color Management Concepts

- **Profile Connection Space (PCS)**: Universal color representation (Lab/XYZ D50)
- **Rendering Intents**: How to handle out-of-gamut colors
- **Black Point Compensation**: Dynamic range adaptation between devices
- **Chromatic Adaptation**: White point adjustments between illuminants
- **Interpolation**: Trilinear and tetrahedral methods for LUT sampling

## Migration Path

The JavaScript implementation serves as:

1. **Proof of concept** for algorithm development
2. **Reference implementation** for validation
3. **API design** platform for WebAssembly migration
4. **Debugging tool** for color transformation analysis

The documented architectural parallels enable straightforward migration to WebAssembly/Little-CMS for production deployment with superior performance and industry validation.
