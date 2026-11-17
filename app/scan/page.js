// app/scan/page.js
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';

export default function Scan() {
  const { wallet } = useWallet();
  const router = useRouter();
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scannedAddress, setScannedAddress] = useState(null);
  const scannerRef = useRef(null);
  const stoppedRef = useRef(false);

  // Navigate after scan via window.location to avoid Next.js Router bugs
  useEffect(() => {
    if (scannedAddress) {
      window.location.href = `/send?to=${encodeURIComponent(scannedAddress)}`;
    }
  }, [scannedAddress]);

  const stopScanner = useCallback(() => {
    if (scannerRef.current && !stoppedRef.current) {
      stoppedRef.current = true;
      scannerRef.current.stop().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!wallet) return;

    let html5QrCode = null;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        html5QrCode = new Html5Qrcode('qr-reader');
        scannerRef.current = html5QrCode;
        stoppedRef.current = false;

        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: Math.min(250, window.innerWidth - 80), height: Math.min(250, window.innerWidth - 80) } },
          (decodedText) => {
            stopScanner();
            const address = decodedText.trim();
            if (address.startsWith('r') && address.length >= 25) {
              setScannedAddress(address);
            } else {
              setError(`Invalid QR code`);
              setScanning(false);
            }
          },
          () => {}
        );
        setScanning(true);
      } catch (err) {
        setError('Camera access denied or not available.');
      }
    };

    startScanner();

    return () => stopScanner();
  }, [wallet, stopScanner]);

  if (!wallet) return null;

  if (scannedAddress) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0D1017] text-[#94A3B8]">
        Opening send...
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-12 max-w-md mx-auto min-h-screen bg-[#0D1017] text-white">
      <header className="flex items-center justify-between mb-6">
        <button onClick={() => router.push('/dashboard')} className="w-10 h-10 rounded-full bg-[#161B26] border border-[#262E3D] flex items-center justify-center text-white text-base hover:bg-[#1E2430] transition-colors">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl font-bold tracking-tight text-white font-display">migo.</span>
        <div className="w-10"></div>
      </header>

      <h2 className="text-2xl font-bold text-white mb-1">Scan QR Code</h2>
      <p className="text-sm text-[#94A3B8] mb-6">Point your camera at the recipient&apos;s QR code.</p>

      <div className="rounded-3xl overflow-hidden mb-6 bg-[#161B26] border border-[#262E3D] shadow-sm" style={{ minHeight: 'min(300px, 50vh)' }}>
        <div id="qr-reader" />
      </div>

      {error && (
        <div className="text-red-400 text-sm font-semibold p-4 rounded-2xl mb-4 bg-red-950/40 border border-red-900/40">{error}</div>
      )}
    </div>
  );
}
