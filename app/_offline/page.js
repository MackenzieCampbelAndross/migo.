'use client';

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#FFFFFF] border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] shadow-sm mb-4">
        <svg className="w-7 h-7 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m10.607 2.121a6 6 0 010 8.485m-8.485 0a6 6 0 010-8.485m5.657 2.121a2 2 0 010 2.828m-2.828 0a2 2 0 010-2.828" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-[#1C1C1E] mb-2">You&apos;re Offline</h1>
      <p className="text-[#8E8E93] text-sm mb-6 max-w-xs">
        Check your internet connection and try again. Migo needs a connection to process payments.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-8 py-3.5 bg-[#000000] text-white font-semibold text-sm rounded-2xl active:scale-[0.99] hover:bg-[#1C1C1E] transition-all shadow-sm"
      >
        Try Again
      </button>
    </div>
  );
}
