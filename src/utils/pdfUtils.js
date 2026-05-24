import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fetchGoogleFontBytes } from './googleFonts';

function hexToRgb(hex = '#000000') {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);

  if (Number.isNaN(value)) {
    return rgb(0, 0, 0);
  }

  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  );
}

export async function buildPdf(
  pdfSources,
  pages,
  annotationsByPage = {},
  extractedTextsByPage = {},
  googleFontSettings = {}
) {
  const newPdf = await PDFDocument.create();
  newPdf.registerFontkit(fontkit);

  const fallbackFont = await newPdf.embedFont(StandardFonts.Helvetica);
  let editFont = null;

  const getEditFont = async () => {
    if (editFont) return editFont;

    try {
      if (googleFontSettings?.url) {
        const fontBytes = await fetchGoogleFontBytes(googleFontSettings.url);
        editFont = await newPdf.embedFont(fontBytes);
        return editFont;
      }
    } catch (err) {
      console.warn('[Export] Could not load Google Font, falling back to Sarabun:', err);
    }

    try {
      const response = await fetch('/fonts/Sarabun-Regular.ttf');
      const fontBytes = await response.arrayBuffer();
      editFont = await newPdf.embedFont(fontBytes);
    } catch (err) {
      console.warn('[Export] Could not load Sarabun font, falling back to Helvetica:', err);
      editFont = fallbackFont;
    }

    return editFont;
  };

  const loadedDocs = await Promise.all(
    pdfSources.map((src) => PDFDocument.load(src.arrayBuffer))
  );

  for (const page of pages) {
    if (page.deleted) continue;

    const sourceDoc = loadedDocs[page.sourceIndex];
    if (!sourceDoc) continue;

    const [copiedPage] = await newPdf.copyPages(sourceDoc, [page.pageIndex]);
    const rawSize = copiedPage.getSize();

    // Apply rotation first so annotation coordinates align with the rotated page
    if (page.rotation && page.rotation !== 0) {
      const currentRotation = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees(currentRotation + page.rotation));
    }

    // BUG-2 fix: When the page is rotated 90° or 270°, the editor shows
    // a rotated viewport but copiedPage.getSize() returns unrotated dimensions.
    // We must swap width/height for annotation coordinate mapping.
    const isSwapped = page.rotation === 90 || page.rotation === 270;
    const width = isSwapped ? rawSize.height : rawSize.width;
    const height = isSwapped ? rawSize.width : rawSize.height;

    const modifiedTexts = (extractedTextsByPage[page.id] || [])
      .filter((item) => item.isModified);

    if (modifiedTexts.length > 0) {
      const activeFont = await getEditFont();

      for (const textItem of modifiedTexts) {
        const originalBoxBottom = textItem.pdfY + textItem.fontSize * (textItem.descent ?? -0.2);
        const originalBoxHeight = textItem.pdfHeight;
        const nextX = textItem.x * width;
        const nextY = height - textItem.y * height - textItem.fontSize;
        const nextWidth = Math.max(1, textItem.width * width);

        copiedPage.drawRectangle({
          x: textItem.pdfX - 1,
          y: originalBoxBottom - 1,
          width: textItem.pdfWidth + 2,
          height: originalBoxHeight + 2,
          color: rgb(1, 1, 1),
          borderWidth: 0,
        });

        copiedPage.drawText(textItem.currentText || '', {
          x: nextX,
          y: nextY,
          size: textItem.fontSize,
          font: activeFont,
          color: rgb(0, 0, 0),
          maxWidth: nextWidth,
          lineHeight: textItem.fontSize * 1.15,
        });
      }
    }

    const pageAnnotations = annotationsByPage[page.id] || [];

    for (const annotation of pageAnnotations) {
      if (annotation.type === 'whiteout') {
        copiedPage.drawRectangle({
          x: annotation.x * width,
          y: height - (annotation.y + annotation.height) * height,
          width: annotation.width * width,
          height: annotation.height * height,
          color: hexToRgb(annotation.color || '#ffffff'),
          borderWidth: 0,
        });
      }

      if (annotation.type === 'text') {
        const activeFont = await getEditFont();

        copiedPage.drawText(annotation.text || '', {
          x: annotation.x * width,
          y: height - annotation.y * height - (annotation.fontSize || 18),
          size: annotation.fontSize || 18,
          font: activeFont,
          color: hexToRgb(annotation.color || '#111827'),
          maxWidth: annotation.width * width,
          lineHeight: (annotation.fontSize || 18) * 1.15,
        });
      }

      if (annotation.type === 'line') {
        copiedPage.drawLine({
          start: {
            x: annotation.x * width,
            y: height - annotation.y * height,
          },
          end: {
            x: annotation.x2 * width,
            y: height - annotation.y2 * height,
          },
          thickness: annotation.thickness || 3,
          color: hexToRgb(annotation.color || '#ef4444'),
        });
      }
    }

    newPdf.addPage(copiedPage);
  }

  return await newPdf.save();
}

export function downloadPdf(pdfBytes, fileName = 'edited.pdf') {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1000);
}
