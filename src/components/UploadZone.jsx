import { useCallback, useState, useRef } from 'react';

export default function UploadZone({ onFilesSelected }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf'
    );
    if (files.length > 0) {
      onFilesSelected(files);
    }
  }, [onFilesSelected]);

  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files).filter(
      (f) => f.type === 'application/pdf'
    );
    if (files.length > 0) {
      onFilesSelected(files);
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [onFilesSelected]);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      id="upload-zone"
      className={`
        relative flex flex-col items-center justify-center
        min-h-[340px] rounded-2xl cursor-pointer
        border-2 border-dashed transition-all duration-300 ease-out
        ${isDragging
          ? 'border-accent-400 bg-accent-500/10 scale-[1.02]'
          : 'border-dark-400 bg-dark-800/50 hover:border-accent-500/50 hover:bg-dark-700/50'
        }
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-accent-500/5 rounded-full blur-3xl" />
      </div>

      {/* Icon */}
      <div className={`
        relative mb-6 w-20 h-20 rounded-2xl
        flex items-center justify-center
        bg-accent-500/10 border border-accent-500/20
        transition-all duration-300
        ${isDragging ? 'scale-110 bg-accent-500/20' : ''}
      `}>
        <svg
          className={`w-10 h-10 transition-all duration-300 ${isDragging ? 'text-accent-300' : 'text-accent-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
        </svg>
      </div>

      {/* Text */}
      <h2 className="relative text-xl font-semibold text-dark-100 mb-2">
        {isDragging ? 'ปล่อยไฟล์ที่นี่!' : 'อัปโหลดไฟล์ PDF'}
      </h2>
      <p className="relative text-sm text-dark-300 mb-4">
        ลากไฟล์มาวาง หรือ คลิกเพื่อเลือกไฟล์
      </p>
      <div className="relative flex items-center gap-2 text-xs text-dark-400">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span>รองรับไฟล์ .pdf | สามารถเลือกได้หลายไฟล์</span>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileInput}
        id="pdf-file-input"
      />
    </div>
  );
}
