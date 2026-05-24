# PDF Editing Implementation Plan

## Goal

Add practical PDF editing behavior on top of the existing page reorder and export flow. The implementation uses annotation-based editing: the original PDF page stays intact, users place editable objects on top, and the app burns those objects into the exported PDF.

## What Was Added (Phase 0 — Overlay Annotations)

- Added a page editor modal that opens from each thumbnail.
- Added annotation state in `App.jsx`, keyed by each loaded page id.
- Added three first-pass editing tools:
  - Text: place text on top of a PDF page.
  - Whiteout: place a white rectangle over existing content.
  - Line: draw a straight line annotation.
- Added object selection, dragging, deletion, and simple properties for text and line objects.
- Updated PDF export so annotations are drawn into the generated PDF with `pdf-lib`.
- Kept page reorder behavior intact, so export still follows the current page order.

---

## Phase 1: Inline Text Editing — Text Layer Extraction ✅ COMPLETED

### What Was Done

**Goal:** Extract original text data and coordinates when rendering a PDF page, so users can later click and edit existing text inline (like Microsoft Word).

**Architecture:** "Read → Mask → Replace" approach:
1. **Read** existing text and bounding boxes via `pdfjs-dist`
2. (Phase 2) **Interact** via HTML overlay elements on top of original text
3. (Phase 3) **Mask & Export** by whiteout + redraw with `pdf-lib`

### Files Created

- `src/utils/textExtractor.js` — **NEW**
  - `extractTextFromPage(pageProxy)` — Extracts all text items from a PDF page.
  - Groups text fragments by baseline Y position into logical line-level items.
  - Returns normalized coordinates (0–1, top-left origin) matching the annotation system.
  - Stores original PDF coordinates (points, bottom-left origin) for export.
  - Returns `ExtractedTextItem[]` with: `id`, `originalText`, `currentText`, `isModified`, `x`, `y`, `width`, `height`, `fontSize`, `fontFamily`, `pdfX`, `pdfY`, `pdfWidth`, `pdfHeight`.

### Files Modified

- `src/App.jsx`
  - Added `extractedTextsByPage` state (keyed by `page.id`).
  - Added `updateExtractedTexts(pageId, texts)` callback.
  - Passes `extractedTexts` and `onExtractedTexts` props to `PDFPageEditor`.
  - Passes `extractedTextsByPage` to `buildPdf()` (unused until Phase 3).
  - Clears `extractedTextsByPage` on reset.

- `src/components/PDFPageEditor.jsx`
  - Imports `extractTextFromPage` from `textExtractor.js`.
  - Accepts `extractedTexts` and `onExtractedTexts` props.
  - Added `useEffect` that calls text extraction when the editor opens.
  - Extraction is lazy (only on first open) and cached (skipped if already extracted).
  - Logs extraction results to console (`console.log` + `console.table`).

- `src/utils/pdfUtils.js`
  - Updated `buildPdf()` signature to accept `extractedTextsByPage` parameter (backward-compatible, unused until Phase 3).

### Data Structure: ExtractedTextItem

```js
{
  id: string,              // crypto.randomUUID()
  originalText: string,    // ข้อความดั้งเดิมจาก PDF
  currentText: string,     // ข้อความปัจจุบัน (edited by user)
  isModified: boolean,     // currentText !== originalText
  x: number,              // normalized 0–1, left edge
  y: number,              // normalized 0–1, top edge
  width: number,          // normalized 0–1
  height: number,         // normalized 0–1
  fontSize: number,       // PDF points
  fontFamily: string,     // from pdfjs styles dict
  pdfX: number,           // original X in PDF points
  pdfY: number,           // baseline Y in PDF points (bottom-up)
  pdfWidth: number,       // width in PDF points
  pdfHeight: number,      // height in PDF points
}
```

### How to Verify

1. Upload any PDF with text content.
2. Click the edit (pencil) button on a page thumbnail.
3. Open browser DevTools console (F12).
4. Look for `[TextExtractor] Page X: N text items extracted` log.
5. Check the `console.table` output for text content and coordinates.

---

## Phase 2: In-Place Editing UI ✅ COMPLETED

### What Was Done

**Goal:** Allow users to double-click any extracted text block and edit it inline, like Microsoft Word.

### Files Created

- `src/components/TextOverlay.jsx` — **NEW**
  - Renders a transparent overlay layer containing all extracted text items.
  - Each text item is absolutely positioned over its original PDF location.
  - When `editText` tool is active: items become interactive with hover highlights.
  - Double-click an item → enters `contentEditable` mode (yellow background, purple border).
  - On blur or Escape → exits editing mode, updates state.
  - Modified text items show a blue dashed border indicator.
  - Uses `pointer-events: none` when other tools are active → no interference.

### Files Modified

- `src/components/PDFPageEditor.jsx`
  - Added `editText` tool to `TOOL_LABELS` (`แก้ไขข้อความ`).
  - Imported and rendered `TextOverlay` component between canvas and annotation layers.
  - Added `handleTextChange(id, newText)` callback for text edits.
  - Added `showTextLayer` toggle state with eye icon button.
  - Added visual separator (`|`) between annotation tools and utility buttons.
  - `addAnnotation` now skips annotation creation when `editText` tool is active.

- `src/index.css`
  - Added `.text-overlay-layer` — container for text items.
  - Added `.text-overlay-item` — transparent by default.
  - Added `.text-overlay-interactive` — hover effect when editText tool active.
  - Added `.text-overlay-editing` — yellow background + purple border for active edit.
  - Added `.text-overlay-modified` — blue dashed border for changed text.

### UX Flow

1. Open page editor → text is automatically extracted (Phase 1).
2. Click **"แก้ไขข้อความ"** tool button in toolbar.
3. Hover over text blocks → purple highlight appears.
4. **Double-click** a text block → enters edit mode (yellow background).
5. Type to modify the text.
6. **Click away** or press **Escape** → exits editing, shows blue dashed border if modified.
7. Toggle the **eye icon** to show/hide text layer.
8. Switch to other tools → text layer becomes non-interactive.

---

## Phase 3: Export & Burn ✅ COMPLETED

### What Was Done

**Goal:** When exporting, whiteout original text and draw the new edited text for every modified text block, using a Thai-compatible embedded font.

### Files Created

- `public/fonts/Sarabun-Regular.ttf` — **NEW** (90KB)
  - Google Fonts open-source font (SIL OFL license).
  - Supports Thai + Latin scripts.
  - Lazy-loaded only when there are modified text blocks to export.

### Files Modified

- `src/utils/pdfUtils.js`
  - Added `getThaiFont()` — lazy-loads and embeds Sarabun font into the PDF document.
  - Added inline text burn logic before annotation burn:
    - Filters `extractedTextsByPage` for `isModified === true` items.
    - **Step 1:** `drawRectangle()` with white fill over original text bounding box (+1px padding).
    - **Step 2:** `drawText()` with new content at the original baseline position using Sarabun font.
  - Falls back to Helvetica if Sarabun font fails to load.

- `src/utils/textExtractor.js`
  - Added `ascent` and `descent` font metrics to `ExtractedTextItem` for accurate whiteout box calculation.

### Export Algorithm

```
For each page:
  1. Filter extractedTexts where isModified === true
  2. If any modified texts exist:
     a. Lazy-load Sarabun font (cached after first load)
     b. For each modified text:
        - Draw white rectangle at (pdfX-1, boxBottom-1) with size (pdfWidth+2, pdfHeight+2)
        - Draw new text at (pdfX, pdfBaseline) with Sarabun font
  3. Then draw existing annotations (text, whiteout, line) as before
```

## Phase 4: OCR / AI Fallback ✅ COMPLETED

### What Was Done

**Goal:** Support editing for scanned PDFs that have no embedded text layer by integrating Tesseract.js client-side OCR.

### Files Created

- `src/utils/ocrEngine.js` — **NEW**
  - Manages Tesseract.js worker lifecycle.
  - Exposes `runOCR(canvas, pageWidth, pageHeight, options)` to perform OCR on the rendered PDF canvas.
  - Maps OCR bounding boxes (in canvas pixels) to normalized coordinates and PDF points for compatibility with Phase 2 (editing) and Phase 3 (exporting).

### Files Modified

- `package.json`
  - Added `tesseract.js` dependency.

- `src/components/PDFPageEditor.jsx`
  - Added "สแกนหาข้อความ (OCR)" button that only appears when `extractedTexts.length === 0` (indicating a scanned page).
  - Handles OCR progress state (`ocrProgress`) and displays it in the button.
  - Populates `extractedTexts` state with OCR results, allowing seamless editing.

### UX Flow (Scanned Pages)

1. Open page editor → text extraction yields 0 items.
2. The "สแกนหาข้อความ (OCR)" button appears in the toolbar.
3. User clicks the button → Tesseract.js worker initializes and processes the canvas.
4. Button shows progress percentage.
5. Once complete, OCR results are mapped into text overlays.
6. Editor automatically switches to the `editText` tool.
7. User can double-click, edit, and export just like native text.

---

## Current Editing Flow

1. Upload a PDF.
2. Click the pencil/edit button on a page thumbnail.
3. Choose a tool in the editor modal.
4. Click on the PDF page to place the object.
5. Drag the object to position it.
6. Adjust text, font size, color, line color, or line thickness when an object is selected.
7. Click `เสร็จ`.
8. Click `บันทึกเป็น PDF` from the main toolbar.

## Technical Design

Annotations are stored as normalized page coordinates:

- `x` and `y` are between `0` and `1`.
- `width` and `height` are between `0` and `1`.
- Lines use `x`, `y`, `x2`, and `y2`.

This keeps annotations independent from screen size and zoom level. During export, normalized coordinates are converted into PDF points based on the copied page size.

## Files Changed (Cumulative)

- `src/App.jsx`
  - Owns annotation state + extracted texts state.
  - Opens and closes the page editor modal.
  - Passes annotations and extracted texts into PDF export.
- `src/components/PDFPageEditor.jsx`
  - Renders a larger editable PDF page.
  - Handles tool selection, object placement, dragging, selection, and property editing.
  - Triggers text layer extraction on page open.
  - Hosts `TextOverlay` for inline editing and OCR functionality.
- `src/components/PdfThumbnail.jsx`
  - Adds an edit button per page.
  - Shows an edit count badge when annotations exist.
- `src/components/TextOverlay.jsx` — **NEW**
  - Transparent overlay for inline text editing using `contentEditable`.
- `src/utils/pdfUtils.js`
  - Draws text, whiteout rectangles, and lines into the exported PDF.
  - Implements whiteout + redraw logic for inline text editing with embedded Sarabun font.
- `src/utils/textExtractor.js` — **NEW**
  - Extracts text layer with coordinates from PDF pages.
- `src/utils/ocrEngine.js` — **NEW**
  - Client-side OCR using Tesseract.js for scanned PDFs.

## Known Limitations

- This is overlay editing, not direct modification of original PDF text streams.
- Font matching between original PDF and overlay is approximate (subset fonts cannot be reused). We use the Sarabun font as a universal replacement for exported edits.
- Rotated pages may need extra coordinate handling during text extraction and OCR.

---

## Phase 5: Movable Text Edits + Google Font Memory

### What Was Done

- Upgraded extracted PDF text from a fixed `contentEditable` box into a movable/resizable edit object.
- Text edits now keep updated normalized `x`, `y`, `width`, and `height` values after dragging or resizing.
- The original extracted PDF position is still preserved for whiteout, while the replacement text exports at the user's current edited position.
- Added resize handles on all four corners for extracted text boxes.
- Added auto-grow behavior while typing so longer replacement text does not immediately clip inside the original PDF text bounds.
- Added a Google Font URL input inside the page editor.
- Added localStorage memory for the last Google Font URL under `edit-pdf-google-font-settings`.
- Added `@pdf-lib/fontkit` so custom fonts can be embedded during PDF export.

### Files Added

- `src/utils/googleFonts.js`
  - Parses Google Font CSS URLs.
  - Applies the font stylesheet to the editor immediately.
  - Stores and restores the last font setting from localStorage.
  - Fetches font bytes from Google Fonts CSS for PDF export.

### Files Modified

- `src/App.jsx`
  - Owns `googleFontSettings`.
  - Restores the last saved Google Font on app load.
  - Passes font settings into the page editor and PDF export.
- `src/components/PDFPageEditor.jsx`
  - Adds the Google Font URL input.
  - Passes active font family into annotation text and extracted text overlays.
- `src/components/TextOverlay.jsx`
  - Adds drag, resize, auto-grow, and live state updates for extracted text edits.
- `src/utils/pdfUtils.js`
  - Registers `fontkit`.
  - Attempts Google Font export first, then falls back to bundled Sarabun, then Helvetica.
  - Draws modified extracted text using current edited position and width.

### UX Flow

1. Paste a Google Font CSS URL, for example:
   `https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap`
2. Click `ใช้ Font`.
3. The editor applies the font immediately and remembers it for next time.
4. Select `แก้ไขข้อความ`.
5. Double-click extracted text to type.
6. Drag the text box to move it.
7. Drag any corner handle to resize it.
8. Export PDF.

### Remaining Notes

- Exporting Google Fonts depends on access to `fonts.googleapis.com` and `fonts.gstatic.com`.
- Google Fonts may serve `woff2`; `fontkit` support can vary by font file. If embedding fails, the exporter falls back to Sarabun.

---

## Phase 6: React contentEditable Fix, Tooling Cleanups, Unified In-Place Text Annotations, & Keyboard Controls ✅ COMPLETED

### What Was Done

**Goal:** Fix React DOM mismatch errors, streamline editor tools by removing the Line drawing feature, unify custom text annotation editing using the same premium inline double-click experience as extracted texts, and implement full keyboard control capability.

- **React DOM Conflict Resolution:**
  - Resolved `NotFoundError: Failed to execute 'removeChild' on 'Node'` React crash caused by browser modifying DOM within React-managed `contentEditable` divs.
  - Split text rendering in `TextOverlayItem` into a Display Layer (managed by React) and an Editing Layer (a temporary `contentEditable` div managed using React refs and direct DOM manipulation).
- **Line Tool Removal:**
  - Completely cleaned up the "Line" tool to keep editor tool selections focused.
  - Removed line options from `TOOL_LABELS`, deleted creation logic, pointer drag handlers, custom property panel, and SVG elements in `PDFPageEditor.jsx`.
  - Cleaned up visual instruction messages in `App.jsx`.
- **Unified Text Annotations Editing:**
  - Upgraded custom text annotations (added via the "ข้อความ" tool) to work exactly like extracted native PDF text blocks.
  - Users can now **double-click** custom text annotations directly on the canvas to edit them inline via a `contentEditable` container.
  - Commits updates on blur or Escape and removes the dependency on the top-bar input box.
- **Pixel-level Size Controls (Width & Height):**
  - Added width (px) and height (px) input fields to the top properties toolbar.
  - The inputs dynamically convert the normalized coordinate sizes (0-1) into layout pixel dimensions based on the page's rendered size (`pageSize`), allowing users to precisely set the dimensions of any selected item (custom text annotations, whiteout boxes, and native extracted text items).
- **Keyboard Shortcuts (Accessibility & Ease of Use):**
  - Added document-level event listener in `PDFPageEditor.jsx` to intercept keystrokes when not actively editing text.
  - **Enter**: Commits page changes and closes the editor modal (same as clicking "เสร็จ").
  - **Backspace / Delete**: Deletes the selected annotation or clears (whites out) the selected extracted text block.
  - **Arrow Keys (Up/Down/Left/Right)**: Nudges the selected object's position finely (by `0.002` normalized coordinate increments). Holding **Shift** scales nudging to `0.01` increments for faster adjustments.
  - **Escape**: Blur active inputs / contentEditable containers. If not editing, deselects the current object. If nothing is selected, closes the page editor.

### Files Modified

- `src/components/TextOverlay.jsx`
  - Replaced local states (`selectedId`, `editingId`) with props passed down from parent for unified state management.
  - Intercepts non-Shift `Enter` key presses inside `contentEditable` elements to commit edits and blur the box.
- `src/components/PDFPageEditor.jsx`
  - Defined unified selection and inline editing states (`selectedId`, `selectedType`, `editingId`, `editingAnnotId`).
  - Added rendering branch for annotations of type `'text'` in editing state to render inline `contentEditable` input fields.
  - Registered window keydown listeners for Escape, Enter, Backspace, Delete, and Arrow Keys (with Shift nudge multiplier).
  - Wired parent selection states down to `TextOverlay`.
  - Cleared all selections and edit modes when switching active tools.
- `src/App.jsx`
  - Removed "และวาดเส้น" reference from the app's welcome description banner.
