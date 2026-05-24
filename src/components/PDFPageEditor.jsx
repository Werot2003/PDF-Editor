import { useCallback, useEffect, useRef, useState } from 'react';
import { extractTextFromPage } from '../utils/textExtractor';
import { runOCR } from '../utils/ocrEngine';
import TextOverlay from './TextOverlay';

const MIN_BOX_SIZE = 0.025;

const TOOL_LABELS = {
  select: 'เลือก',
  editText: 'แก้ไขข้อความ',
  moveText: 'ย้าย/ขยาย ข้อความ',
  text: 'ข้อความ',
  whiteout: 'ปิดทับ',
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const createAnnotation = (type, point) => {
  const base = {
    id: crypto.randomUUID(),
    type,
    x: point.x,
    y: point.y,
    color: '#111827',
  };

  if (type === 'text') {
    return {
      ...base,
      text: 'ข้อความใหม่',
      fontSize: 18,
      width: 0.3,
      height: 0.06,
    };
  }

  if (type === 'whiteout') {
    return {
      ...base,
      color: '#ffffff',
      width: 0.24,
      height: 0.07,
    };
  }

  return base;
};

export default function PDFPageEditor({
  page,
  pageNumber,
  totalPages,
  annotations,
  onChangeAnnotations,
  extractedTexts,
  onExtractedTexts,
  googleFontSettings,
  onGoogleFontChange,
  onClose,
}) {
  const canvasRef = useRef(null);
  const pageFrameRef = useRef(null);
  const renderTaskRef = useRef(null);
  const actionRef = useRef(null);
  const [tool, setTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedType, setSelectedType] = useState(null); // 'annotation' | 'textItem'
  const [editingId, setEditingId] = useState(null); // for textItem inline edit
  const [editingAnnotId, setEditingAnnotId] = useState(null); // for annotation inline edit
  const editAnnotRef = useRef(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [showTextLayer, setShowTextLayer] = useState(true);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [fontUrlInput, setFontUrlInput] = useState(googleFontSettings?.url || '');

  const changeTool = useCallback((newTool) => {
    setTool(newTool);
    setSelectedId(null);
    setSelectedType(null);
    setEditingId(null);
    setEditingAnnotId(null);
  }, []);

  // Handle setting inline text content and focus for annotations
  useEffect(() => {
    if (editingAnnotId && editAnnotRef.current) {
      const activeAnnot = annotations.find((a) => a.id === editingAnnotId);
      if (activeAnnot) {
        editAnnotRef.current.textContent = activeAnnot.text || '';
        editAnnotRef.current.focus();

        try {
          const range = document.createRange();
          range.selectNodeContents(editAnnotRef.current);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        } catch {
          // ignore
        }
      }
    }
  }, [editingAnnotId, annotations]);

  const handleAnnotInput = (event) => {
    const nextText = event.currentTarget.textContent || '';
    updateAnnotation(editingAnnotId, { text: nextText });
  };

  const handleAnnotKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    event.stopPropagation();
  };

  const handleTextUpdate = useCallback((id, updater) => {
    if (!extractedTexts) return;
    const updated = extractedTexts.map((item) =>
      item.id === id
        ? (typeof updater === 'function' ? updater(item) : { ...item, ...updater })
        : item
    );
    onExtractedTexts(updated);
  }, [extractedTexts, onExtractedTexts]);

  useEffect(() => {
    if (!page?.pageProxy) return undefined;

    let cancelled = false;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const renderPage = async () => {
      try {
        // 1. ดึงค่าความหนาแน่นพิกเซลของจอผู้ใช้ (ถ้าจอธรรมดา = 1, จอคมชัดสูง = 2+)
        const pixelRatio = window.devicePixelRatio || 1;
        const baseScale = 1.35; // ขนาด layout ที่เราต้องการบนจอ

        // 2. สร้าง Viewport สำหรับขนาด Layout (เอาไว้คำนวณตำแหน่งกล่องข้อความ)
        const layoutViewport = page.pageProxy.getViewport({
          scale: baseScale,
          rotation: page.rotation,
        });

        // 3. สร้าง Viewport ความละเอียดสูงสำหรับการวาดลง Canvas จริงๆ
        const renderViewport = page.pageProxy.getViewport({
          scale: baseScale * pixelRatio, // คูณพิกเซลเพิ่มเข้าไปให้ภาพคม
          rotation: page.rotation,
        });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        // กำหนดขนาดภายในของ Canvas (Backing Store) ให้สูงตาม renderViewport
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;

        // ส่วนขนาดกรอบสีขาวด้านนอก ให้ใช้ขนาด layout ปกติ เพื่อให้กล่องข้อความไม่เพี้ยน
        setPageSize({ width: layoutViewport.width, height: layoutViewport.height });

        // สั่งให้ PDF.js วาดด้วย Viewport ตัวที่ความละเอียดสูง
        const task = page.pageProxy.render({
          canvasContext: canvas.getContext('2d'),
          viewport: renderViewport,
        });

        renderTaskRef.current = task;
        await task.promise;

        if (!cancelled) {
          renderTaskRef.current = null;
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Error rendering editor page:', err);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [page, page?.rotation]);

  // --- Phase 1: Text Layer Extraction ---
  useEffect(() => {
    if (!page?.pageProxy) return;
    // Skip if already extracted for this page
    if (extractedTexts) return;

    let cancelled = false;

    const extract = async () => {
      try {
        const totalRotation = ((page.pageProxy.rotate || 0) + (page.rotation || 0)) % 360;
        const items = await extractTextFromPage(page.pageProxy, totalRotation);

        if (!cancelled && items.length > 0) {
          console.log(`[TextExtractor] Page ${pageNumber}: ${items.length} text items extracted`);
          console.table(items.map((t) => ({
            text: t.currentText.substring(0, 40),
            x: t.x.toFixed(3),
            y: t.y.toFixed(3),
            w: t.width.toFixed(3),
            h: t.height.toFixed(3),
            fontSize: t.fontSize.toFixed(1),
          })));
          onExtractedTexts(items);
        } else if (!cancelled) {
          console.log(`[TextExtractor] Page ${pageNumber}: No text content found (scanned page?)`);
          onExtractedTexts([]);
        }
      } catch (err) {
        console.error('[TextExtractor] Extraction failed:', err);
      }
    };

    extract();

    return () => {
      cancelled = true;
    };
  }, [page, extractedTexts, onExtractedTexts, pageNumber]);

  // BUG-10 fix: Invalidate extracted texts when rotation changes
  // so text re-extraction uses the correct rotated coordinates.
  const prevRotationRef = useRef(page?.rotation);
  useEffect(() => {
    if (prevRotationRef.current !== page?.rotation && extractedTexts) {
      prevRotationRef.current = page?.rotation;
      onExtractedTexts(null);
    }
  }, [page?.rotation, extractedTexts, onExtractedTexts]);

  const handleRunOCR = async () => {
    if (!canvasRef.current || !page?.pageProxy) return;

    setIsOcrRunning(true);
    setOcrProgress(0);

    try {
      const unrotatedViewport = page.pageProxy.getViewport({ scale: 1, rotation: 0 });
      const totalRotation = ((page.pageProxy.rotate || 0) + (page.rotation || 0)) % 360;

      const items = await runOCR(
        canvasRef.current,
        unrotatedViewport.width,
        unrotatedViewport.height,
        {
          lang: 'tha+eng',
          onProgress: (p) => setOcrProgress(p),
          totalRotation,
        }
      );

      if (items.length > 0) {
        onExtractedTexts(items);
        changeTool('editText');
      } else {
        alert('ไม่พบข้อความในหน้านี้ (No text found)');
      }
    } catch (err) {
      console.error('OCR failed:', err);
      alert('เกิดข้อผิดพลาดในการรัน OCR');
    } finally {
      setIsOcrRunning(false);
      setOcrProgress(0);
    }
  };

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!actionRef.current || !pageFrameRef.current) return;

      const { id, kind, original, startX, startY } = actionRef.current;
      const rect = pageFrameRef.current.getBoundingClientRect();
      const dx = (event.clientX - startX) / rect.width;
      const dy = (event.clientY - startY) / rect.height;

      onChangeAnnotations((items) =>
        items.map((item) => {
          if (item.id !== id) return item;



          if (kind === 'resize-box') {
            const nextWidth = clamp(original.width + dx, MIN_BOX_SIZE, 1 - original.x);
            const nextHeight = clamp(original.height + dy, MIN_BOX_SIZE, 1 - original.y);

            return {
              ...item,
              width: nextWidth,
              height: nextHeight,
            };
          }

          return {
            ...item,
            x: clamp(original.x + dx, 0, 1 - item.width),
            y: clamp(original.y + dy, 0, 1 - item.height),
          };
        })
      );
    };

    const handlePointerUp = () => {
      actionRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onChangeAnnotations]);

  const getPoint = (event) => {
    const rect = pageFrameRef.current.getBoundingClientRect();

    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  const addAnnotation = (event) => {
    if (tool === 'select' || tool === 'editText' || tool === 'moveText') {
      setSelectedId(null);
      setSelectedType(null);
      return;
    }

    const annotation = createAnnotation(tool, getPoint(event));

    onChangeAnnotations((items) => [...items, annotation]);
    setSelectedId(annotation.id);
    setSelectedType('annotation');
    changeTool('select');
  };

  const updateAnnotation = (id, patch) => {
    onChangeAnnotations((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const handleApplyGoogleFont = () => {
    onGoogleFontChange(fontUrlInput.trim());
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;

    if (selectedType === 'annotation') {
      onChangeAnnotations((items) => items.filter((item) => item.id !== selectedId));
    } else if (selectedType === 'textItem') {
      handleTextUpdate(selectedId, {
        currentText: '',
        isModified: true,
      });
    }

    setSelectedId(null);
    setSelectedType(null);
  }, [selectedId, selectedType, onChangeAnnotations, handleTextUpdate]);

  const startAction = (event, annotation, kind) => {
    event.stopPropagation();   // ✅ คงตัวนี้ไว้เพื่อไม่ให้ event ทะลุไปหา Canvas ด้านหลัง
    setSelectedId(annotation.id);
    setSelectedType('annotation');
    setEditingId(null);
    setEditingAnnotId(null);

    actionRef.current = {
      id: annotation.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      original: annotation,
    };
  };

  // Keyboard navigation & controls
  useEffect(() => {
    const handleKeyDown = (event) => {
      const isTyping = () => {
        const active = document.activeElement;
        if (!active) return false;
        return (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.hasAttribute('contenteditable') ||
          active.isContentEditable
        );
      };

      if (isTyping()) {
        if (event.key === 'Escape') {
          document.activeElement.blur();
          setEditingAnnotId(null);
          setEditingId(null);
        }
        return;
      }

      if (event.key === 'Escape') {
        if (selectedId) {
          setSelectedId(null);
          setSelectedType(null);
        } else {
          onClose();
        }
        return;
      }

      if (event.key === 'Enter') {
        onClose();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        removeSelected();
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (!selectedId) return;

        event.preventDefault();

        // Step size: Shift key makes nudges larger
        const step = event.shiftKey ? 0.01 : 0.002;
        let dx = 0;
        let dy = 0;

        if (event.key === 'ArrowUp') dy = -step;
        if (event.key === 'ArrowDown') dy = step;
        if (event.key === 'ArrowLeft') dx = -step;
        if (event.key === 'ArrowRight') dx = step;

        if (selectedType === 'annotation') {
          onChangeAnnotations((items) =>
            items.map((item) => {
              if (item.id !== selectedId) return item;
              return {
                ...item,
                x: clamp(item.x + dx),
                y: clamp(item.y + dy),
              };
            })
          );
        } else if (selectedType === 'textItem') {
          handleTextUpdate(selectedId, (item) => {
            const nextX = clamp(item.x + dx, 0, 1 - item.width);
            const nextY = clamp(item.y + dy, 0, 1 - item.height);
            return {
              ...item,
              x: nextX,
              y: nextY,
              isModified: nextX !== item.x || nextY !== item.y || item.currentText !== item.originalText,
            };
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    selectedId,
    selectedType,
    removeSelected,
    onChangeAnnotations,
    handleTextUpdate,
    onClose,
  ]);

  const selectedAnnotation = annotations.find((item) => item.id === selectedId);
  const selectedTextItem = extractedTexts?.find((item) => item.id === selectedId);
  const activeItem = selectedType === 'annotation' ? selectedAnnotation : (selectedType === 'textItem' ? selectedTextItem : null);

  const handlePropertyChange = (patch) => {
    if (!activeItem) return;

    if (selectedType === 'annotation') {
      updateAnnotation(activeItem.id, patch);
    } else if (selectedType === 'textItem') {
      handleTextUpdate(activeItem.id, {
        ...patch,
        isModified: true,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-dark-900/95 backdrop-blur-xl">
      <div className="border-b border-dark-600 bg-dark-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-dark-100">
              แก้ไขหน้า {pageNumber || '-'} / {totalPages}
            </h2>
            <p className="text-xs text-dark-300">
              คลิกเพื่อเลือกวัตถุ ลากเพื่อย้าย และลากจุดจับเพื่อปรับขนาด
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(TOOL_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => changeTool(value)}
                className={tool === value ? 'btn-primary !py-2 !px-4' : 'btn-secondary !py-2 !px-4'}
              >
                {label}
              </button>
            ))}

            {extractedTexts && extractedTexts.length === 0 && (
              <>
                <div className="w-px h-7 bg-dark-500 mx-1" />
                <button
                  type="button"
                  onClick={handleRunOCR}
                  disabled={isOcrRunning}
                  className="btn-primary !py-2 !px-4 !bg-gradient-to-r !from-blue-600 !to-indigo-600 hover:!from-blue-500 hover:!to-indigo-500 disabled:opacity-50"
                  title="สแกนข้อความด้วย AI"
                >
                  {isOcrRunning ? `กำลังสแกน... ${Math.round(ocrProgress * 100)}%` : 'สแกนหาข้อความ (OCR)'}
                </button>
              </>
            )}

            <div className="w-px h-7 bg-dark-500 mx-1" />

            <button
              type="button"
              onClick={() => setShowTextLayer((v) => !v)}
              className={showTextLayer ? 'btn-primary !py-2 !px-4' : 'btn-secondary !py-2 !px-4'}
              title="แสดง/ซ่อน Text Layer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={showTextLayer ? 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z' : 'M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88'} />
                {showTextLayer && <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />}
              </svg>
            </button>

            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedId}
              className="btn-secondary !py-2 !px-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ลบวัตถุ
            </button>

            <button type="button" onClick={onClose} className="btn-primary !py-2 !px-5">
              เสร็จ
            </button>
          </div>
        </div>
      </div>

      {activeItem && (
        <div className="border-b border-dark-600 bg-dark-800/80 px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
            {(selectedType === 'textItem' || activeItem.type === 'text') && (
              <>
                <input
                  value={selectedType === 'annotation' ? (activeItem.text || '') : (activeItem.currentText || '')}
                  onChange={(event) => {
                    const textVal = event.target.value;
                    handlePropertyChange(
                      selectedType === 'annotation'
                        ? { text: textVal }
                        : { currentText: textVal }
                    );
                  }}
                  className="min-w-[220px] rounded-lg border border-dark-500 bg-dark-700 px-3 py-2 text-sm text-white outline-none focus:border-accent-400"
                  placeholder="ข้อความ"
                />
                <label className="flex items-center gap-2 text-xs text-dark-200">
                  ขนาด
                  <input
                    type="number"
                    min="8"
                    max="120"
                    value={Math.round(activeItem.fontSize)}
                    onChange={(event) => {
                      const sizeVal = Number(event.target.value) || 18;
                      handlePropertyChange({ fontSize: sizeVal });
                    }}
                    className="w-20 rounded-lg border border-dark-500 bg-dark-700 px-2 py-2 text-sm text-white outline-none focus:border-accent-400"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-dark-200">
                  สี
                  <input
                    type="color"
                    value={activeItem.color || '#111827'}
                    onChange={(event) => {
                      handlePropertyChange({ color: event.target.value });
                    }}
                    className="h-9 w-12 rounded-lg border border-dark-500 bg-dark-700"
                  />
                </label>
              </>
            )}

            <label className="flex items-center gap-2 text-xs text-dark-200">
              กว้าง (px)
              <input
                type="number"
                min="5"
                max="2000"
                value={Math.round((activeItem.width || 0) * pageSize.width)}
                onChange={(event) => {
                  const pxVal = Number(event.target.value) || 50;
                  const normWidth = clamp(pxVal / pageSize.width, 0.005, 1);
                  handlePropertyChange({ width: normWidth });
                }}
                className="w-20 rounded-lg border border-dark-500 bg-dark-700 px-2 py-2 text-sm text-white outline-none focus:border-accent-400"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-dark-200">
              สูง (px)
              <input
                type="number"
                min="5"
                max="2000"
                value={Math.round((activeItem.height || 0) * pageSize.height)}
                onChange={(event) => {
                  const pxVal = Number(event.target.value) || 20;
                  const normHeight = clamp(pxVal / pageSize.height, 0.005, 1);
                  handlePropertyChange({ height: normHeight });
                }}
                className="w-20 rounded-lg border border-dark-500 bg-dark-700 px-2 py-2 text-sm text-white outline-none focus:border-accent-400"
              />
            </label>
          </div>
        </div>
      )}

      <div className="border-b border-dark-600 bg-dark-800/70 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="text-xs font-medium text-dark-200 lg:w-36">
            Google Font URL
          </label>
          <input
            value={fontUrlInput}
            onChange={(event) => setFontUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleApplyGoogleFont();
              }
            }}
            placeholder="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap"
            className="min-w-0 flex-1 rounded-lg border border-dark-500 bg-dark-700 px-3 py-2 text-sm text-white outline-none focus:border-accent-400"
          />
          <button type="button" onClick={handleApplyGoogleFont} className="btn-secondary !py-2 !px-4">
            ใช้ Font
          </button>
          {googleFontSettings?.family && (
            <span className="text-xs text-dark-200">
              ใช้อยู่: {googleFontSettings.family}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="mx-auto w-fit">
          <div
            ref={pageFrameRef}
            className="relative bg-white shadow-2xl"
            style={{ width: pageSize.width, height: pageSize.height }}
            onPointerDown={addAnnotation}
          >
            <canvas ref={canvasRef} className="block w-full h-full" />

            {showTextLayer && extractedTexts && extractedTexts.length > 0 && (
              <TextOverlay
                items={extractedTexts}
                toolMode={tool === 'editText' || tool === 'moveText' ? tool : null}
                pageSize={pageSize}
                fontFamily={googleFontSettings?.family}
                onTextUpdate={handleTextUpdate}
                selectedId={selectedType === 'textItem' ? selectedId : null}
                setSelectedId={(id) => {
                  setSelectedId(id);
                  setSelectedType(id ? 'textItem' : null);
                }}
                editingId={editingId}
                setEditingId={setEditingId}
              />
            )}

            {annotations.map((annotation) => {
              const isSelected = annotation.id === selectedId;
              const isEditing = editingAnnotId === annotation.id;

              if (annotation.type === 'text' && isEditing) {
                return (
                  <div
                    key={annotation.id}
                    ref={editAnnotRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="absolute text-overlay-item text-overlay-editing p-1"
                    style={{
                      left: `${annotation.x * 100}%`,
                      top: `${annotation.y * 100}%`,
                      width: `${annotation.width * 100}%`,
                      height: `${annotation.height * 100}%`,
                      color: '#111827',
                      fontSize: annotation.fontSize,
                      fontFamily: googleFontSettings?.family || 'sans-serif',
                      lineHeight: 1.1,
                      whiteSpace: 'pre-wrap',
                      zIndex: 20,
                      outline: '2px solid #8b5cf6',
                      cursor: 'text',
                      userSelect: 'text',
                      boxSizing: 'border-box',
                    }}
                    onBlur={() => setEditingAnnotId(null)}
                    onInput={handleAnnotInput}
                    onKeyDown={handleAnnotKeyDown}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                );
              }

              return (
                <div
                  key={annotation.id}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => startAction(event, annotation, 'move-box')}
                  onDoubleClick={(event) => {
                    if (annotation.type === 'text') {
                      event.stopPropagation();
                      setEditingAnnotId(annotation.id);
                      setEditingId(null);
                    }
                  }}
                  className={`absolute cursor-move touch-none ${isSelected ? 'outline outline-2 outline-accent-400' : ''}`}
                  style={{
                    left: `${annotation.x * 100}%`,
                    top: `${annotation.y * 100}%`,
                    width: `${annotation.width * 100}%`,
                    height: `${annotation.height * 100}%`,
                    background: annotation.type === 'whiteout' ? annotation.color : 'transparent',
                    color: annotation.color,
                    fontSize: annotation.fontSize,
                    fontFamily: googleFontSettings?.family || 'sans-serif',
                    lineHeight: 1.1,
                    padding: annotation.type === 'text' ? 2 : 0,
                    whiteSpace: 'pre-wrap',
                    userSelect: 'none',
                    visibility: isEditing ? 'hidden' : 'visible',
                  }}
                >
                  {annotation.type === 'text' ? annotation.text : null}

                  {isSelected && (
                    <button
                      type="button"
                      aria-label="ปรับขนาด"
                      className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border-2 border-white bg-accent-400 shadow-lg"
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={(event) => startAction(event, annotation, 'resize-box')}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(tool === 'editText' || tool === 'moveText') && extractedTexts && extractedTexts.length > 0 && (
        <div className="sticky-text-toolbar">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="flex items-center bg-dark-700 rounded-xl p-1 gap-0.5">
              <button
                type="button"
                onClick={() => changeTool('editText')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tool === 'editText'
                    ? 'bg-gradient-to-r from-accent-500 to-accent-400 text-white shadow-lg shadow-accent-500/25'
                    : 'text-dark-200 hover:text-white hover:bg-dark-600'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
                พิมพ์แก้ไข
              </button>
              <button
                type="button"
                onClick={() => changeTool('moveText')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tool === 'moveText'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25'
                    : 'text-dark-200 hover:text-white hover:bg-dark-600'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
                ย้าย/ขยาย
              </button>
            </div>

            <div className="w-px h-8 bg-dark-500/50" />

            <div className="flex items-center gap-2 text-xs text-dark-300">
              {tool === 'editText' && (
                <>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-dark-700 rounded-md border border-dark-500/50">
                    <svg className="w-3 h-3 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
                    </svg>
                    ดับเบิลคลิก
                  </span>
                  <span>เพื่อแก้ข้อความ</span>
                  <span className="text-dark-500">|</span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-dark-700 rounded-md border border-dark-500/50">
                    Esc
                  </span>
                  <span>จบการแก้ไข</span>
                </>
              )}
              {tool === 'moveText' && (
                <>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-dark-700 rounded-md border border-dark-500/50">
                    <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5" />
                    </svg>
                    ลากกรอบ
                  </span>
                  <span>เพื่อย้ายตำแหน่ง</span>
                  <span className="text-dark-500">|</span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-dark-700 rounded-md border border-dark-500/50">
                    <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                    </svg>
                    ลากจุดมุม
                  </span>
                  <span>เพื่อปรับขนาด</span>
                </>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Close text tools */}
            <button
              type="button"
              onClick={() => setTool('select')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-dark-300 hover:text-white bg-dark-700 hover:bg-dark-600 rounded-lg border border-dark-500/50 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              ปิดเครื่องมือข้อความ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
