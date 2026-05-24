import { useCallback, useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import Toolbar from './components/Toolbar';
import PdfThumbnail from './components/PdfThumbnail';
import PDFPageEditor from './components/PDFPageEditor';
import { buildPdf, downloadPdf } from './utils/pdfUtils';
import { applyGoogleFont, getStoredGoogleFontSettings } from './utils/googleFonts';
import { terminateOCR } from './utils/ocrEngine';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

function App() {
  const [pdfSources, setPdfSources] = useState([]);
  const [pages, setPages] = useState([]);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [annotations, setAnnotations] = useState({});
  const [extractedTextsByPage, setExtractedTextsByPage] = useState({});
  const [googleFontSettings, setGoogleFontSettings] = useState(() => getStoredGoogleFontSettings());
  const [editingPageIndex, setEditingPageIndex] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (googleFontSettings.url) {
      applyGoogleFont(googleFontSettings.url);
    }
  }, [googleFontSettings.url]);

  const loadPdfFiles = useCallback(async (files) => {
    setIsLoading(true);

    try {
      const newSources = [];
      const newPages = [];

      // Use functional update to get accurate current source count
      let currentSourceCount = 0;
      setPdfSources((prev) => {
        currentSourceCount = prev.length;
        return prev;
      });

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const arrayBuffer = await file.arrayBuffer();
        const sourceIndex = currentSourceCount + i;

        newSources.push({ arrayBuffer, fileName: file.name });

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;

        for (let p = 0; p < pdf.numPages; p += 1) {
          const pageProxy = await pdf.getPage(p + 1);

          newPages.push({
            id: `${sourceIndex}-${p}-${crypto.randomUUID()}`,
            sourceIndex,
            pageIndex: p,
            rotation: 0,
            deleted: false,
            pageProxy,
          });
        }

        if (!pdfInfo && i === 0) {
          setPdfInfo({
            name: file.name,
            totalPages: pdf.numPages,
          });
        }
      }

      setPdfSources((prev) => [...prev, ...newSources]);
      setPages((prev) => {
        const combined = [...prev, ...newPages];

        setPdfInfo((info) => ({
          name: info?.name || newSources[0]?.fileName || 'PDF',
          totalPages: combined.length,
        }));

        return combined;
      });
    } catch (err) {
      console.error('Error loading PDF:', err);
      alert('เกิดข้อผิดพลาดในการอ่านไฟล์ PDF กรุณาลองใหม่');
    } finally {
      setIsLoading(false);
    }
  }, [pdfInfo]);

  const handleDeletePage = useCallback((index) => {
    setPages((prev) =>
      prev.map((page, pageIndex) => (
        pageIndex === index ? { ...page, deleted: true } : page
      ))
    );
  }, []);

  const handleRotatePage = useCallback((index) => {
    setPages((prev) =>
      prev.map((page, pageIndex) => (
        pageIndex === index
          ? { ...page, rotation: (page.rotation + 90) % 360 }
          : page
      ))
    );
  }, []);

  const updatePageAnnotations = useCallback((pageId, updater) => {
    setAnnotations((prev) => {
      const currentAnnotations = prev[pageId] || [];
      const nextAnnotations = typeof updater === 'function'
        ? updater(currentAnnotations)
        : updater;

      return {
        ...prev,
        [pageId]: nextAnnotations,
      };
    });
  }, []);

  const updateExtractedTexts = useCallback((pageId, texts) => {
    setExtractedTextsByPage((prev) => ({
      ...prev,
      [pageId]: texts,
    }));
  }, []);

  const handleGoogleFontChange = useCallback((url) => {
    const settings = applyGoogleFont(url);
    setGoogleFontSettings(settings);
  }, []);

  const handleMovePage = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }

    setPages((prev) => {
      // BUG-4 fix: fromIndex and toIndex are visual display indices
      // (among visible/non-deleted pages only). We need to map them
      // back to actual array indices in the full `pages` array.
      const visibleIndices = [];
      for (let i = 0; i < prev.length; i++) {
        if (!prev[i].deleted) {
          visibleIndices.push(i);
        }
      }

      if (fromIndex >= visibleIndices.length || toIndex >= visibleIndices.length) {
        return prev;
      }

      const actualFrom = visibleIndices[fromIndex];
      const actualTo = visibleIndices[toIndex];

      const next = [...prev];
      const [movedPage] = next.splice(actualFrom, 1);

      if (!movedPage) {
        return prev;
      }

      // After removing the item, the target index may have shifted.
      // Recalculate the insertion point based on the new array.
      const newVisibleIndices = [];
      for (let i = 0; i < next.length; i++) {
        if (!next[i].deleted) {
          newVisibleIndices.push(i);
        }
      }

      // Clamp toIndex in case it's at the end
      const insertAt = toIndex >= newVisibleIndices.length
        ? next.length
        : newVisibleIndices[toIndex];

      next.splice(insertAt, 0, movedPage);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setPdfSources([]);
    setPages([]);
    setPdfInfo(null);
    setAnnotations({});
    setExtractedTextsByPage({});
    setEditingPageIndex(null);
    // BUG-6 fix: Terminate OCR worker to free memory
    terminateOCR().catch(() => {});
  }, []);

  const handleExport = useCallback(async () => {
    const pagesToExport = pages.filter((page) => !page.deleted);

    if (pagesToExport.length === 0) {
      return;
    }

    setIsExporting(true);

    try {
      const pdfBytes = await buildPdf(
        pdfSources,
        pages,
        annotations,
        extractedTextsByPage,
        googleFontSettings
      );
      const baseName = pdfInfo?.name?.replace(/\.pdf$/i, '') || 'document';
      downloadPdf(pdfBytes, `${baseName}_edited.pdf`);
    } catch (err) {
      console.error('Export error:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกไฟล์ PDF');
    } finally {
      setIsExporting(false);
    }
  }, [pages, pdfSources, pdfInfo, annotations, extractedTextsByPage, googleFontSettings]);

  const activePages = pages.filter((page) => !page.deleted).length;
  const hasPages = pages.length > 0;
  const visiblePages = pages.reduce((acc, page, index) => {
    if (!page.deleted) {
      acc.push({ ...page, originalIndex: index });
    }

    return acc;
  }, []);
  const editingPage = editingPageIndex !== null ? pages[editingPageIndex] : null;

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {!hasPages && !isLoading && (
          <div className="max-w-2xl mx-auto animate-fade-in-up">
            <UploadZone onFilesSelected={loadPdfFiles} />
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in-up">
            <div className="w-16 h-16 border-4 border-accent-400 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-dark-200 text-sm">กำลังโหลดไฟล์ PDF...</p>
          </div>
        )}

        {hasPages && !isLoading && (
          <>
            <Toolbar
              pdfInfo={pdfInfo}
              activePages={activePages}
              onAddFiles={loadPdfFiles}
              onExport={handleExport}
              onReset={handleReset}
              isExporting={isExporting}
            />

            <div className="mb-4 text-sm text-dark-300">
              ลากการ์ดเพื่อสลับลำดับหน้า หรือกดปุ่มดินสอเพื่อเพิ่มข้อความ และปิดทับข้อความเดิม
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visiblePages.map((page, index) => (
                <PdfThumbnail
                  key={page.id}
                  pageData={page.pageProxy}
                  pageIndex={page.originalIndex}
                  displayIndex={index}
                  rotation={page.rotation}
                  onDelete={handleDeletePage}
                  onRotate={handleRotatePage}
                  onMove={handleMovePage}
                  onEdit={setEditingPageIndex}
                  annotationsCount={annotations[page.id]?.length || 0}
                  totalPages={visiblePages.length}
                />
              ))}
            </div>

            {activePages === 0 && (
              <div className="text-center py-16 animate-fade-in-up">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-dark-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 0v3.375m0 0H9.75m3.375 0H15M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <p className="text-dark-300 mb-4">ลบหน้าทั้งหมดแล้ว</p>
                <button onClick={handleReset} className="btn-primary">
                  เริ่มใหม่
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {editingPage && (
        <PDFPageEditor
          page={editingPage}
          pageNumber={visiblePages.findIndex((page) => page.originalIndex === editingPageIndex) + 1}
          totalPages={visiblePages.length}
          annotations={annotations[editingPage.id] || []}
          onChangeAnnotations={(updater) => updatePageAnnotations(editingPage.id, updater)}
          extractedTexts={extractedTextsByPage[editingPage.id] || null}
          onExtractedTexts={(texts) => updateExtractedTexts(editingPage.id, texts)}
          googleFontSettings={googleFontSettings}
          onGoogleFontChange={handleGoogleFontChange}
          onClose={() => setEditingPageIndex(null)}
        />
      )}

      <footer className="py-4 text-center text-xs text-dark-400 border-t border-dark-700/50">
        PDF Editor - แก้ไข PDF ออนไลน์ ฟรี ไม่ต้องลงโปรแกรม
      </footer>
    </div>
  );
}

export default App;
