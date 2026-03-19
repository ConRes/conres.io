/*************************************************************************
 *  @license
 *
 *
 *  Copyright © 2019, 2024 Glenn Wilton
 *  O2 Creative Limited
 *  www.o2creative.co.nz
 *  support@o2creative.co.nz
 *
 * jsColorEngine is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 *
 */

/**
 * @fileoverview Main entry point for the JavaScript Color Engine
 * Exports all public APIs including Profile, Transform, color conversion utilities, and enumerations
 * 
 * @license GPL-3.0-or-later
 * @copyright 2019, 2024 Glenn Wilton, O2 Creative Limited
 */

// @ts-check

/**
 * Color conversion utilities for creating and manipulating color objects
 * Provides factory functions for different color spaces and conversion methods
 */
export { default as convert } from './convert.js';

/**
 * Spectral color utilities for advanced color calculations
 * Handles spectral power distributions, color matching functions, and illuminant calculations
 */
export { Spectral } from './spectral.js';

/**
 * Loader utilities for profile and data loading
 * Provides cross-platform loading capabilities for browser and Node.js environments
 */
export { Loader } from './loader.js';

/**
 * ICC Profile class for loading and managing color profiles
 * Supports loading from multiple sources: binary data, files, URLs, base64, and virtual profiles
 */
export { Profile } from './profile.js';

/**
 * Transform class for color space conversions
 * Handles complex color transformations between different color spaces using ICC profiles
 */
export { Transform } from './transform.js';

/**
 * LookupTable class for efficient color transformation via lookup tables
 * Provides enhanced CMYK processing options and high-performance interpolation
 */
export { LookupTable } from './lut.js';

/**
 * Core definitions and enumerations for the color engine
 * Contains color types, profile types, rendering intents, and encoding specifications
 */
export { eColourType, eProfileType, eIntent, encoding, encodingStr, cgatsIntentString, intent2String } from './def.js';
