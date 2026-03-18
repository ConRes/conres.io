import { PDFService } from "../../services/PDFService.js";
import { PDFDocument } from "pdf-lib";

export default async () => {
    const pdfSourceURL = new URL('../../../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x.pdf', import.meta.url);
    const pdfBuffer = await (await fetch(pdfSourceURL)).arrayBuffer();
    const pdfDocument = await PDFDocument.load(pdfBuffer);

    PDFService.decalibrateColorInPDFDocument(pdfDocument);
};
