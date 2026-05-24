export default function Header() {
  return (
    <header className="relative py-6 px-6 border-b border-dark-700/50">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 left-1/4 w-60 h-60 bg-accent-500/8 rounded-full blur-3xl" />
        <div className="absolute -top-10 right-1/3 w-40 h-40 bg-accent-300/5 rounded-full blur-2xl" />
      </div>

      <div className="relative flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-400 flex items-center justify-center shadow-lg shadow-accent-500/25">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              PDF Editor
            </h1>
            <p className="text-xs text-dark-300">
              แก้ไข จัดเรียง และรวมไฟล์ PDF
            </p>
          </div>
        </div>

        {/* Version badge */}
        <div className="hidden sm:flex items-center gap-2 text-xs text-dark-400 bg-dark-800 px-3 py-1.5 rounded-full border border-dark-600">
          <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" />
          <span>v1.0</span>
        </div>
      </div>
    </header>
  );
}
