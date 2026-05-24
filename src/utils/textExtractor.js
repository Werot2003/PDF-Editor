/**
 * Text Extraction Utility for Inline PDF Editing
 * 
 * Extracts text content from a PDF page using pdfjs-dist's getTextContent(),
 * groups text fragments by line, and returns normalized coordinates (0–1)
 * with top-left origin — matching the existing annotation coordinate system.
 */

const Y_GROUP_TOLERANCE = 3; // PDF points tolerance for same-line grouping

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Extract text items from a PDF page proxy.
 * @param {Object} pageProxy - pdfjs-dist PDFPageProxy
 * @returns {Promise<Array>} Array of ExtractedTextItem objects
 */
export async function extractTextFromPage(pageProxy) {
  // Get unrotated page dimensions (scale=1 gives us raw PDF points)
  const viewport = pageProxy.getViewport({ scale: 1, rotation: 0 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const textContent = await pageProxy.getTextContent();

  if (!textContent?.items?.length) {
    return [];
  }

  // Step 1: Parse raw text items from pdfjs-dist
  const rawItems = [];

  for (const item of textContent.items) {
    if (!item.str || item.str.trim().length === 0) continue;
    if (!item.transform) continue;

    const [scaleX, skewY, , , tx, ty] = item.transform;

    // Font size derived from transform matrix
    const fontSize = Math.hypot(scaleX, skewY) || 12;

    // Font style info from the styles dictionary
    const style = textContent.styles?.[item.fontName] || {};

    rawItems.push({
      str: item.str,
      pdfX: tx,
      pdfBaseline: ty,
      pdfWidth: item.width,
      fontSize,
      fontFamily: style.fontFamily || 'sans-serif',
      ascent: style.ascent ?? 0.8,
      descent: style.descent ?? -0.2,
    });
  }

  if (rawItems.length === 0) {
    return [];
  }

  // Step 2: Group items by text line
  const lineGroups = groupByLine(rawItems, Y_GROUP_TOLERANCE);

  // Step 3: Convert each line group to an ExtractedTextItem
  return lineGroups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];

    // Merge text fragments, inserting spaces where there are gaps
    let mergedText = '';
    for (let i = 0; i < group.length; i++) {
      if (i > 0) {
        const prev = group[i - 1];
        const gap = group[i].pdfX - (prev.pdfX + prev.pdfWidth);
        const spaceWidth = prev.fontSize * 0.25;
        if (gap > spaceWidth) {
          mergedText += ' ';
        }
      }
      mergedText += group[i].str;
    }

    // PDF coordinates
    const pdfX = first.pdfX;
    const pdfBaseline = first.pdfBaseline;
    const pdfWidth = (last.pdfX + last.pdfWidth) - first.pdfX;
    const fontSize = first.fontSize;

    // Compute text box in PDF coordinates (bottom-left origin)
    const pdfTop = pdfBaseline + fontSize * first.ascent;
    const pdfBottom = pdfBaseline + fontSize * first.descent;
    const pdfHeight = pdfTop - pdfBottom;

    // Normalized coordinates (top-left origin, 0–1)
    const x = clamp01(pdfX / pageWidth);
    const y = clamp01(1 - pdfTop / pageHeight);
    const width = clamp01(pdfWidth / pageWidth);
    const height = clamp01(pdfHeight / pageHeight);

    return {
      id: crypto.randomUUID(),
      originalText: mergedText,
      currentText: mergedText,
      isModified: false,

      // Normalized coords for overlay rendering
      x,
      y,
      width,
      height,

      // Font metadata
      fontSize,
      fontFamily: first.fontFamily,
      ascent: first.ascent,
      descent: first.descent,

      // Original PDF coords for export (Phase 3)
      pdfX,
      pdfY: pdfBaseline,
      pdfWidth,
      pdfHeight,
    };
  });
}

/**
 * Group raw text items by baseline Y position (same line).
 * Within each line, items are sorted left-to-right.
 */
function groupByLine(items, yTolerance) {
  // Sort by baseline Y descending (top-of-page first), then X ascending
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.pdfBaseline - b.pdfBaseline) > yTolerance) {
      return b.pdfBaseline - a.pdfBaseline;
    }
    return a.pdfX - b.pdfX;
  });

  const lines = [];
  let currentLine = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const avgBaseline =
      currentLine.reduce((sum, it) => sum + it.pdfBaseline, 0) /
      currentLine.length;

    if (Math.abs(item.pdfBaseline - avgBaseline) <= yTolerance) {
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
    }
  }

  lines.push(currentLine);
  return lines;
}
