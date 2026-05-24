import { useRef } from 'react';

export default function Toolbar({
  pdfInfo,
  activePages,
  onAddFiles,
  onExport,
  onReset,
  isExporting,
}) {
  const fileInputRef = useRef(null);

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files).filter(
      (file) => file.type === 'application/pdf'
    );

    if (files.length > 0) {
      onAddFiles(files);
    }

    event.target.value = '';
  };

  return (
    <div className="glass-card p-4 mb-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-500/15 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-dark-100">
              {pdfInfo?.name || 'PDF Document'}
            </h3>
            <p className="text-xs text-dark-300">
              {activePages} หน้าที่เหลือ จากทั้งหมด {pdfInfo?.totalPages || 0} หน้า
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleAddClick}
            className="btn-secondary"
            id="add-more-files"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            เพิ่มไฟล์
          </button>

          <button
            onClick={onReset}
            className="btn-secondary"
            id="reset-btn"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            รีเซ็ต
          </button>

          <button
            onClick={onExport}
            disabled={isExporting || activePages === 0}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            id="export-pdf-btn"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                บันทึกเป็น PDF
              </>
            )}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
