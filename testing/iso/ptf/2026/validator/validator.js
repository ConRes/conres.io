// @ts-check
/**
 * PDF Validator bootstrap module.
 *
 * Registers the custom element and initializes the validator UI.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFValidatorAppElement } from './elements/pdf-validator-app-element.js';

customElements.define('pdf-validator-app', PDFValidatorAppElement);

export function bootstrap() {
    const element = /** @type {PDFValidatorAppElement} */ (
        document.querySelector('pdf-validator-app')
    );
    if (element) {
        element.configure();
    }
}
