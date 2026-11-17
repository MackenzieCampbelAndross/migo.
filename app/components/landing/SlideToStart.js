// app/components/landing/SlideToStart.js
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../WalletProvider';

export default function SlideToStart({ className = '' }) {
  const router = useRouter();
  const { wallet } = useWallet();
  const trackRef = useRef(null);
  const [dragProgress, setDragProgress] = useState(0); // 0 to 1
  const [isDragging, setIsDragging] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const startXRef = useRef(0);
  const maxDragRef = useRef(0);

  const handleSuccess = useCallback(() => {
    setIsCompleted(true);
    setDragProgress(1);
    setTimeout(() => {
      if (wallet) {
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    }, 350);
  }, [wallet, router]);

  const updateDrag = useCallback((clientX) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const thumbWidth = 52;
    const maxDrag = Math.max(1, rect.width - thumbWidth - 8);
    maxDragRef.current = maxDrag;

    const currentX = clientX - rect.left - 4;
    const progress = Math.min(1, Math.max(0, currentX / maxDrag));
    setDragProgress(progress);

    if (progress >= 0.88 && !isCompleted) {
      handleSuccess();
    }
  }, [isCompleted, handleSuccess]);

  // Touch handlers
  const handleTouchStart = (e) => {
    if (isCompleted) return;
    setIsDragging(true);
    startXRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e) => {
    if (!isDragging || isCompleted) return;
    updateDrag(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (isCompleted) return;
    setIsDragging(false);
    if (dragProgress < 0.88) {
      setDragProgress(0);
    }
  };

  // Mouse handlers
  const handleMouseDown = (e) => {
    if (isCompleted) return;
    setIsDragging(true);
    startXRef.current = e.clientX;
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging || isCompleted) return;
      updateDrag(e.clientX);
    };

    const onMouseUp = () => {
      if (!isDragging || isCompleted) return;
      setIsDragging(false);
      if (dragProgress < 0.88) {
        setDragProgress(0);
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, isCompleted, dragProgress, updateDrag]);

  const thumbOffset = dragProgress * (maxDragRef.current || 200);

  return (
    <div className={`w-full max-w-sm mx-auto select-none ${className}`}>
      <div
        ref={trackRef}
        onClick={() => {
          if (!isCompleted) handleSuccess();
        }}
        className="relative h-15 bg-[#161B26] border border-[#262E3D] hover:border-[#7C3AED]/70 rounded-full p-1.5 flex items-center cursor-pointer transition-colors overflow-hidden"
      >
        {/* Active progress track */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-[#7C3AED]/20 transition-all pointer-events-none rounded-full"
          style={{ width: `${Math.max(thumbOffset + 52, 52)}px` }}
        />

        {/* Text prompt */}
        <div className="w-full text-center pointer-events-none pr-3 pl-14">
          <span className="text-xs sm:text-sm font-bold tracking-wider text-white uppercase flex items-center justify-center gap-1.5">
            {isCompleted ? (
              <span>Connecting to Migo...</span>
            ) : (
              <>
                <span>Slide to Get Started</span>
                <span className="text-[#94A3B8] font-normal">→</span>
              </>
            )}
          </span>
        </div>

        {/* Sliding Thumb Handle */}
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: `translateX(${thumbOffset}px)`,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          className={`absolute left-1.5 top-1.5 w-12 h-12 rounded-full flex items-center justify-center text-white cursor-grab active:cursor-grabbing z-10 transition-colors shadow-md ${
            isCompleted ? 'bg-[#7C3AED]' : 'bg-[#7C3AED] hover:bg-[#6D28D9]'
          }`}
        >
          {isCompleted ? (
            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
