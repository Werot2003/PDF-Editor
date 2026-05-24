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

export function mapVisualToPhysical(x, y, w, h, W, H, rotation) {
  let xPhys, yPhys, wPhys, hPhys, rotateDegrees;

  if (rotation === 0) {
    rotateDegrees = 0;
    wPhys = w * W;
    hPhys = h * H;
    xPhys = x * W;
    yPhys = (1 - y - h) * H;
  } else if (rotation === 90) {
    rotateDegrees = 90;
    wPhys = w * H;
    hPhys = h * W;
    xPhys = (y + h) * W;
    yPhys = x * H;
  } else if (rotation === 180) {
    rotateDegrees = 180;
    wPhys = w * W;
    hPhys = h * H;
    xPhys = (1 - x) * W;
    yPhys = (y + h) * H;
  } else if (rotation === 270) {
    rotateDegrees = 270;
    wPhys = w * H;
    hPhys = h * W;
    xPhys = (1 - y - h) * W;
    yPhys = (1 - x) * H;
  }

  return {
    x: xPhys,
    y: yPhys,
    width: wPhys,
    height: hPhys,
    rotate: rotateDegrees,
  };
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

    const finalRotation = copiedPage.getRotation().angle % 360;

    const modifiedTexts = (extractedTextsByPage[page.id] || [])
      .filter((item) => item.isModified);

    if (modifiedTexts.length > 0) {
      const activeFont = await getEditFont();

      for (const textItem of modifiedTexts) {
        // Step 1: Draw white rectangle over the original text box
        const originalBoxBottom = textItem.pdfY + textItem.fontSize * (textItem.descent ?? -0.2);
        const originalBoxHeight = textItem.pdfHeight;

        copiedPage.drawRectangle({
          x: textItem.pdfX - 1,
          y: originalBoxBottom - 1,
          width: textItem.pdfWidth + 2,
          height: originalBoxHeight + 2,
          color: rgb(1, 1, 1),
          borderWidth: 0,
        });

        // Step 2: Draw new text at the visual edited position
        const mapped = mapVisualToPhysical(
          textItem.x,
          textItem.y,
          textItem.width,
          textItem.height,
          rawSize.width,
          rawSize.height,
          finalRotation
        );

        copiedPage.drawText(textItem.currentText || '', {
          x: mapped.x,
          y: mapped.y,
          size: textItem.fontSize,
          font: activeFont,
          color: rgb(0, 0, 0),
          maxWidth: mapped.width,
          lineHeight: textItem.fontSize * 1.15,
          rotate: degrees(mapped.rotate),
        });
      }
    }

    const pageAnnotations = annotationsByPage[page.id] || [];

    for (const annotation of pageAnnotations) {
      if (annotation.type === 'whiteout') {
        const mapped = mapVisualToPhysical(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height,
          rawSize.width,
          rawSize.height,
          finalRotation
        );

        copiedPage.drawRectangle({
          x: mapped.x,
          y: mapped.y,
          width: mapped.width,
          height: mapped.height,
          color: hexToRgb(annotation.color || '#ffffff'),
          borderWidth: 0,
          rotate: degrees(mapped.rotate),
        });
      }

      if (annotation.type === 'text') {
        const activeFont = await getEditFont();
        const mapped = mapVisualToPhysical(
          annotation.x,
          annotation.y,
          annotation.width,
          annotation.height,
          rawSize.width,
          rawSize.height,
          finalRotation
        );

        copiedPage.drawText(annotation.text || '', {
          x: mapped.x,
          y: mapped.y,
          size: annotation.fontSize || 18,
          font: activeFont,
          color: hexToRgb(annotation.color || '#111827'),
          maxWidth: mapped.width,
          lineHeight: (annotation.fontSize || 18) * 1.15,
          rotate: degrees(mapped.rotate),
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
