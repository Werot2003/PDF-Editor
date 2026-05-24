import { useEffect, useRef, useState } from 'react';

export default function PdfThumbnail({
  pageData,
  pageIndex,
  displayIndex,
  rotation,
  onDelete,
  onRotate,
  onMove,
  onEdit,
  annotationsCount = 0,
  totalPages,
}) {
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [isRendered, setIsRendered] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!pageData) return undefined;

    let cancelled = false;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const renderPage = async () => {
      setIsRendered(false);

      try {
        const viewport = pageData.getViewport({ scale: 0.4, rotation });
        const canvas = canvasRef.current;

        if (!canvas || cancelled) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const task = pageData.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
        });

        renderTaskRef.current = task;
        await task.promise;

        if (!cancelled) {
          renderTaskRef.current = null;
          setIsRendered(true);
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', err);
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
  }, [pageData, rotation]);

  const handleDragStart = (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(displayIndex));
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);

    const fromIndex = Number(event.dataTransfer.getData('text/plain'));

    if (!Number.isNaN(fromIndex)) {
      onMove(fromIndex, displayIndex);
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        group relative glass-card p-3 animate-fade-in-up
        hover:scale-[1.03] transition-all duration-300 cursor-move
        ${isDragOver ? 'ring-2 ring-accent-400 scale-[1.02]' : ''}
      `}
      style={{ animationDelay: `${displayIndex * 50}ms` }}
    >
      <div className="absolute top-2 left-2 z-10 bg-dark-800/90 backdrop-blur-sm text-xs font-medium text-dark-200 px-2.5 py-1 rounded-lg border border-dark-500/50">
        {displayIndex + 1} / {totalPages}
      </div>

      <div className="absolute top-2 right-2 z-10 bg-accent-500/15 text-[11px] font-medium text-accent-200 px-2 py-1 rounded-lg border border-accent-500/20">
        {annotationsCount > 0 ? `${annotationsCount} edit` : 'ลากเพื่อสลับ'}
      </div>

      <div className="relative rounded-xl overflow-hidden bg-white mb-3 flex items-center justify-center min-h-[200px]">
        {!isRendered && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-700">
            <div className="w-8 h-8 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="max-w-full h-auto block"
          style={{ maxHeight: '280px' }}
        />
      </div>

      <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onEdit(pageIndex);
          }}
          className="btn-icon"
          title="แก้ไขหน้านี้"
          id={`edit-page-${pageIndex}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 7.125L16.875 4.5M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
        </button>

        <button
          onClick={(event) => {
            event.stopPropagation();
            onRotate(pageIndex);
          }}
          className="btn-icon"
          title="หมุนหน้า 90 องศา"
          id={`rotate-page-${pageIndex}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
        </button>

        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete(pageIndex);
          }}
          className="btn-icon hover:!bg-danger-500 hover:!border-danger-400"
          title="ลบหน้านี้"
          id={`delete-page-${pageIndex}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>
    </div>
  );
}
