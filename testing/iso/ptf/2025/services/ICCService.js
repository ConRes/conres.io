// @ts-check
import { parse as parseICCHeaderFromBuffer } from "icc";
import { Buffer } from "../helpers.js";

/**
 * Service for ICC profile operations
 */
export class ICCService {
    /**
     * Parse ICC header from buffer
     * @param {ArrayBuffer | Uint8Array | Buffer | import('node:buffer').Buffer} iccProfileSource - The ICC profile buffer
     * @returns {ReturnType<import('icc')['parse']>} - Parsed ICC header information
     */
    static parseICCHeaderFromSource(iccProfileSource) {
        return iccProfileSource instanceof Buffer ? parseICCHeaderFromBuffer(/** @type {*} */(iccProfileSource))
            : iccProfileSource instanceof ArrayBuffer ? parseICCHeaderFromBuffer(/** @type {*} */(new Buffer(iccProfileSource)))
                : iccProfileSource instanceof Uint8Array ? parseICCHeaderFromBuffer(/** @type {*} */(new Buffer(/** @type {*} */(iccProfileSource.buffer))))
                    : parseICCHeaderFromBuffer(/** @type {*} */(iccProfileSource));
    }
}
