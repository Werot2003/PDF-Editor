/**
 * OCR Engine Utility for Scanned PDF Pages
 *
 * Uses Tesseract.js to perform client-side OCR on a canvas image.
 * Returns results in the same ExtractedTextItem format used by textExtractor.js,
 * so OCR results can be edited and exported identically to native PDF text.
 */
import { createWorker } from 'tesseract.js';

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
 * @param {number} pageWidth - Page width in PDF points (for coordinate mapping)
 * @param {number} pageHeight - Page height in PDF points (for coordinate mapping)
 * @param {object} options
 * @param {string} options.lang - OCR language(s), default 'tha+eng'
 * @param {function} options.onProgress - Progress callback (0–1)
 * @param {number} options.layoutWidth - Layout width in CSS pixels (for HiDPI correction)
 * @param {number} options.layoutHeight - Layout height in CSS pixels (for HiDPI correction)
 * @returns {Promise<Array>} ExtractedTextItem[] with normalized coordinates
 */
export async function runOCR(canvas, pageWidth, pageHeight, options = {}) {
  const { lang = 'tha+eng', onProgress, layoutWidth, layoutHeight } = options;

  const worker = await getWorker(lang, onProgress);

  // Convert canvas to base64 data URL
  const imageData = canvas.toDataURL('image/png');

  // Run recognition
  const { data } = await worker.recognize(imageData);

  if (!data?.lines?.length) {
    return [];
  }

  // OCR bbox is in canvas pixel coordinates (backing store size).
  // Use canvas.width/height to convert bbox → ratio, then normalize.
  // But for normalized coords (0–1 matching the editor overlay),
  // we must account for HiDPI scaling: the canvas backing store
  // is larger than the CSS layout by devicePixelRatio.
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
      // This correctly maps to 0–1 regardless of pixel ratio
      const x = bbox.x0 / canvasWidth;
      const y = bbox.y0 / canvasHeight;
      const width = (bbox.x1 - bbox.x0) / canvasWidth;
      const height = (bbox.y1 - bbox.y0) / canvasHeight;

      // Convert to PDF points for export
      const pdfX = x * pageWidth;
      const pdfWidth = width * pageWidth;
      const lineHeight = height * pageHeight;

      // Estimate font size from line height (roughly 80% of line height)
      const fontSize = lineHeight * 0.8;

      // PDF Y coordinate (bottom-up, baseline position)
      // Baseline is approximately at the bottom of the text minus descent
      const pdfTop = pageHeight - (y * pageHeight);
      const pdfBaseline = pdfTop - fontSize * 0.8; // approximate baseline

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
        pdfHeight: lineHeight,

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
