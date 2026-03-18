#!/usr/bin/env node
// @ts-check
/**
 * extract-pdf-text.js - Extract text content from PDF files
 *
 * Used to extract text from Acrobat Preflight validation reports
 * for comparison without loading large PDF binaries into context.
 *
 * Usage:
 *   node extract-pdf-text.js <input.pdf> [--output=<output.txt>] [--verbose]
 *
 * Example:
 *   node extract-pdf-text.js "validation-report.pdf" --output=report.txt
 */

import { readFile, writeFile } from 'fs/promises';
import { basename, extname, dirname, join } from 'path';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFString, PDFHexString } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args) {
    const options = {
        inputPath: null,
        outputPath: null,
        verbose: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }

        if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
            continue;
        }

        if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
            options.outputPath = arg.split('=')[1];
            continue;
        }

        if (arg === '--output' || arg === '-o') {
            options.outputPath = args[++i];
            continue;
        }

        // Positional argument - input file
        if (!arg.startsWith('-')) {
            options.inputPath = arg;
        }
    }

    return options;
}

function printUsage() {
    console.log(`
extract-pdf-text.js - Extract text content from PDF files

Usage:
  node extract-pdf-text.js <input.pdf> [options]

Options:
  --output=<path>, -o <path>    Output file path (default: stdout)
  --verbose, -v                 Show detailed progress
  --help, -h                    Show this help

Example:
  node extract-pdf-text.js "validation-report.pdf" --output=report.txt
  node extract-pdf-text.js "report.pdf" > output.txt
`);
}

// ============================================================================
// PDF Text Extraction
// ============================================================================

/**
 * Extract text from a PDF content stream
 * @param {string} content - Decoded content stream
 * @returns {string[]} - Array of text strings found
 */
function extractTextFromContentStream(content) {
    const textParts = [];

    // PDF text operators:
    // Tj - show string
    // TJ - show array of strings/positioning
    // ' - move to next line and show string
    // " - move to next line, set spacing, show string

    // Match text show operators with their string operands
    // This regex captures:
    // 1. String literals: (text) for Tj or '
    // 2. Hex strings: <hexdata> for Tj
    // 3. Arrays: [...] for TJ

    // Pattern for parenthesized strings (handles nested parens and escapes)
    const stringPattern = /\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)/g;
    const hexPattern = /<[0-9A-Fa-f\s]+>/g;
    const arrayPattern = /\[([^\]]+)\]\s*TJ/gi;
    const simpleTextPattern = /\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)\s*(?:Tj|'|")/g;

    // Extract from TJ arrays (most common in structured text)
    let match;
    while ((match = arrayPattern.exec(content)) !== null) {
        const arrayContent = match[1];
        // Extract strings from the array
        let strMatch;
        const strRegex = /\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)/g;
        while ((strMatch = strRegex.exec(arrayContent)) !== null) {
            const decoded = decodePDFString(strMatch[0]);
            if (decoded.trim()) {
                textParts.push(decoded);
            }
        }
        // Also check for hex strings in array
        const hexRegex = /<([0-9A-Fa-f\s]+)>/g;
        while ((strMatch = hexRegex.exec(arrayContent)) !== null) {
            const decoded = decodeHexString(strMatch[1]);
            if (decoded.trim()) {
                textParts.push(decoded);
            }
        }
    }

    // Extract from simple Tj operations
    const tjPattern = /\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)\s*Tj/g;
    while ((match = tjPattern.exec(content)) !== null) {
        const strMatch = match[0].match(/\((?:[^()\\]|\\.|\((?:[^()\\]|\\.)*\))*\)/);
        if (strMatch) {
            const decoded = decodePDFString(strMatch[0]);
            if (decoded.trim()) {
                textParts.push(decoded);
            }
        }
    }

    // Extract hex strings used with Tj
    const hexTjPattern = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    while ((match = hexTjPattern.exec(content)) !== null) {
        const decoded = decodeHexString(match[1]);
        if (decoded.trim()) {
            textParts.push(decoded);
        }
    }

    return textParts;
}

/**
 * Decode a UTF-16BE encoded string
 * @param {string} str - String with UTF-16BE encoded bytes
 * @returns {string} - Decoded UTF-16 string
 */
function decodeUTF16BE(str) {
    let result = '';
    for (let i = 0; i < str.length - 1; i += 2) {
        const highByte = str.charCodeAt(i);
        const lowByte = str.charCodeAt(i + 1);
        const codePoint = (highByte << 8) | lowByte;
        result += String.fromCharCode(codePoint);
    }
    return result;
}

/**
 * Decode a PDF string literal (parenthesized string)
 * Handles both byte strings and UTF-16BE encoded strings
 * @param {string} str - String including parentheses, e.g., "(Hello)"
 * @returns {string} - Decoded string
 */
function decodePDFString(str) {
    // Remove outer parentheses
    let inner = str.slice(1, -1);

    // Handle escape sequences first
    inner = inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        // Octal escapes \ddd
        .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

    // Check for UTF-16BE encoding
    // BOM marker is \xFE\xFF, or we detect alternating null bytes
    if (inner.charCodeAt(0) === 0xFE && inner.charCodeAt(1) === 0xFF) {
        // Has BOM - decode as UTF-16BE starting after BOM
        return decodeUTF16BE(inner.slice(2));
    } else if (inner.length >= 2 && inner.charCodeAt(0) === 0 && inner.charCodeAt(1) !== 0) {
        // Starts with null byte followed by non-null - likely UTF-16BE without BOM
        return decodeUTF16BE(inner);
    }

    return inner;
}

/**
 * Decode a PDF hex string
 * @param {string} hex - Hex string without angle brackets
 * @returns {string} - Decoded string
 */
function decodeHexString(hex) {
    // Remove whitespace
    hex = hex.replace(/\s/g, '');
    // Pad to even length
    if (hex.length % 2 !== 0) {
        hex += '0';
    }

    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
        const charCode = parseInt(hex.substr(i, 2), 16);
        result += String.fromCharCode(charCode);
    }
    return result;
}

/**
 * Clean up spaced-out text (common in PDFs where each char is positioned separately)
 * Handles patterns like "H e l l o   W o r l d" -> "Hello World"
 * Double-spaces represent word boundaries, single spaces are between chars.
 * @param {string} text
 * @returns {string}
 */
function cleanSpacedText(text) {
    if (!text || text.length < 3) return text;

    // Trim leading/trailing spaces
    let trimmed = text.trim();
    if (trimmed.length < 3) return trimmed;

    // Check if this looks like spaced text by examining the pattern
    // Look for "char space char" sequences that aren't at word boundaries
    const singleCharSpacePattern = /[^\s] [^\s]/g;
    const matches = trimmed.match(singleCharSpacePattern) || [];

    // If we have many single-char-space-char patterns, it's likely spaced text
    // A normal sentence wouldn't have many of these
    const textWithoutMultiSpace = trimmed.replace(/  +/g, ' ');
    const normalWordCount = textWithoutMultiSpace.split(' ').filter(w => w.length > 1).length;
    const spacedCharCount = matches.length;

    // If most "words" are actually single characters with spaces, clean it up
    if (spacedCharCount > normalWordCount * 2) {
        // Split by double-spaces first (word boundaries)
        const words = trimmed.split(/  +/);
        // For each "word", remove the single spaces between chars
        const cleanedWords = words.map(word => {
            // Check if this word follows the "c h a r" pattern
            const chars = word.split(' ');
            if (chars.length > 1 && chars.every(c => c.length <= 1)) {
                // It's spaced chars - join them
                return chars.join('');
            }
            return word;
        });
        return cleanedWords.join(' ');
    }

    return trimmed;
}

/**
 * Post-process extracted text to improve readability
 * @param {string} text
 * @returns {string}
 */
function postProcessText(text) {
    // Clean spaced text
    let result = cleanSpacedText(text);

    // Fix common OCR/extraction issues
    result = result
        // Fix spacing around punctuation
        .replace(/\s+([.,;:!?)])/g, '$1')
        .replace(/([(\[])\s+/g, '$1')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim();

    return result;
}

/**
 * Extract all text from a PDF document
 * @param {PDFDocument} pdfDocument
 * @param {object} options
 * @returns {Promise<{pages: Array<{pageNum: number, text: string}>, fullText: string}>}
 */
async function extractText(pdfDocument, options = {}) {
    const pages = pdfDocument.getPages();
    const pageTexts = [];

    pages[0].getText

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageNum = i + 1;
        const textParts = [];

        if (options.verbose) {
            console.error(`Processing page ${pageNum}/${pages.length}...`);
        }

        // Get page contents
        const contents = page.node.Contents();
        if (!contents) {
            pageTexts.push({ pageNum, text: '' });
            continue;
        }

        // Contents can be a single stream or an array of streams
        const contentRefs = contents instanceof PDFArray
            ? contents.asArray()
            : [contents];

        for (const ref of contentRefs) {
            const stream = pdfDocument.context.lookup(ref);
            if (!(stream instanceof PDFRawStream)) continue;

            try {
                const decoded = decodePDFRawStream(stream).decode();
                const contentString = new TextDecoder('latin1').decode(decoded);
                const extracted = extractTextFromContentStream(contentString);
                // Clean each extracted string individually (handles spaced chars)
                for (const str of extracted) {
                    const cleaned = cleanSpacedText(str);
                    if (cleaned.trim()) {
                        textParts.push(cleaned);
                    }
                }
            } catch (err) {
                if (options.verbose) {
                    console.error(`  Warning: Could not decode content stream: ${err.message}`);
                }
            }
        }

        // Join text parts with spaces
        const rawText = textParts.join(' ');
        const pageText = postProcessText(rawText);

        pageTexts.push({ pageNum, text: pageText });
    }

    // Build full text with page separators
    const fullText = pageTexts
        .map(p => `--- Page ${p.pageNum} ---\n${p.text}`)
        .join('\n\n');

    return { pages: pageTexts, fullText };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    if (!options.inputPath) {
        console.error('Error: No input file specified');
        printUsage();
        process.exit(1);
    }

    try {
        if (options.verbose) {
            console.error(`Reading: ${options.inputPath}`);
        }

        const pdfBytes = await readFile(options.inputPath);
        const pdfDocument = await PDFDocument.load(pdfBytes, {
            ignoreEncryption: true,
            updateMetadata: false
        });

        const result = await extractText(pdfDocument, options);

        if (options.outputPath) {
            await writeFile(options.outputPath, result.fullText);
            if (options.verbose) {
                console.error(`Written to: ${options.outputPath}`);
            }
        } else {
            console.log(result.fullText);
        }

        if (options.verbose) {
            console.error(`\nExtracted ${result.pages.length} page(s)`);
            const totalChars = result.pages.reduce((sum, p) => sum + p.text.length, 0);
            console.error(`Total characters: ${totalChars}`);
        }

    } catch (err) {
        console.error(`Error: ${err.message}`);
        if (options.verbose) {
            console.error(err.stack);
        }
        process.exit(1);
    }
}

main();
