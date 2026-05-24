/**
 * OCR Engine Utility for Scanned PDF Pages
 *
 * Uses Tesseract.js to perform client-side OCR on a canvas image.
 * Returns results in the same ExtractedTextItem format used by textExtractor.js,
 * so OCR results can be edited and exported identically to native PDF text.
 */
import { createWorker } from 'tesseract.js';
import { mapVisualToPhysical } from './pdfUtils';

let cachedWorker = null;

/**
 * Get or create a Tesseract worker (cached for reuse).
 * @param {string} lang - Language code(s), e.g. 'tha+eng'
 * @param {function} onProgress - Progress callback (0–1)
 */
async function getWorker(lang = 'tha+eng', onProgress) {
  if (cachedWorker) return cachedWorker;

  const worker = await createWorker(lang, undefined, {
    logger: (info) => {
      if (onProgress && info.progress != null) {
        onProgress(info.progress);
      }
    },
  });

  cachedWorker = worker;
  return worker;
}

/**
 * Run OCR on a canvas element and return ExtractedTextItem[] format.
 *
 * @param {HTMLCanvasElement} canvas - The rendered PDF page canvas
 * @param {number} unrotatedWidth - Unrotated page width in PDF points
 * @param {number} unrotatedHeight - Unrotated page height in PDF points
 * @param {object} options
 * @param {string} options.lang - OCR language(s), default 'tha+eng'
 * @param {function} options.onProgress - Progress callback (0–1)
 * @param {number} options.totalRotation - Total rotation of the page
 * @returns {Promise<Array>} ExtractedTextItem[] with normalized coordinates mapped to unrotated space
 */
export async function runOCR(canvas, unrotatedWidth, unrotatedHeight, options = {}) {
  const { lang = 'tha+eng', onProgress, totalRotation = 0 } = options;

  const worker = await getWorker(lang, onProgress);

  // Convert canvas to base64 data URL
  const imageData = canvas.toDataURL('image/png');

  // Run recognition
  const { data } = await worker.recognize(imageData);

  if (!data?.lines?.length) {
    return [];
  }

  // OCR bbox is in canvas pixel coordinates (backing store size).
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // Map OCR lines to ExtractedTextItem format
  return data.lines
    .filter((line) => line.text && line.text.trim().length > 0)
    .map((line) => {
      const { bbox } = line;
      const text = line.text.trim();

      // OCR bbox is in canvas pixel coordinates (backing store)
      // Convert to normalized (0–1) coordinates using canvas dimensions
      const x = bbox.x0 / canvasWidth;
      const y = bbox.y0 / canvasHeight;
      const width = (bbox.x1 - bbox.x0) / canvasWidth;
      const height = (bbox.y1 - bbox.y0) / canvasHeight;

      // Map to unrotated physical PDF coordinates
      const mapped = mapVisualToPhysical(
        x,
        y,
        width,
        height,
        unrotatedWidth,
        unrotatedHeight,
        totalRotation
      );

      const pdfX = mapped.x;
      const pdfWidth = mapped.width;
      const pdfHeight = mapped.height;

      // Estimate font size from physical line height (roughly 80% of line height)
      const fontSize = pdfHeight * 0.8;

      // Calculate baseline based on the mapped bottom coordinate
      const pdfBaseline = mapped.y + pdfHeight * 0.16;

      return {
        id: crypto.randomUUID(),
        originalText: text,
        currentText: text,
        isModified: false,

        // Normalized coords (top-left origin)
        x,
        y,
        width,
        height,

        // Font metadata
        fontSize,
        fontFamily: 'sans-serif',
        ascent: 0.8,
        descent: -0.2,

        // PDF coords for export
        pdfX,
        pdfY: pdfBaseline,
        pdfWidth,
        pdfHeight,

        // Mark as OCR-sourced
        isOCR: true,
      };
    });
}

/**
 * Terminate the cached worker to free resources.
 */
export async function terminateOCR() {
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }
}
