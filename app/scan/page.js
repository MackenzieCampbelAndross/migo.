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
      <div className="flex items-center justify-center h-screen text-[#8E8E93]">
        Opening send...
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-12 max-w-md mx-auto">
      <header className="flex items-center justify-between mb-6">
        <button onClick={() => router.push('/dashboard')} className="w-9 h-9 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#1C1C1E] text-base hover:bg-[#E5E5EA] transition-colors">
          ←
        </button>
        <span className="text-xl font-bold tracking-tight text-[#1C1C1E]">Migo.</span>
        <div className="w-9"></div>
      </header>

      <h2 className="text-2xl font-bold text-[#1C1C1E] mb-1">Scan QR Code</h2>
      <p className="text-sm text-[#8E8E93] mb-6">Point your camera at the recipient&apos;s QR code.</p>

      <div className="rounded-3xl overflow-hidden mb-6 bg-[#F2F2F7] border border-[#E5E5EA] shadow-sm" style={{ minHeight: 'min(300px, 50vh)' }}>
        <div id="qr-reader" />
      </div>

      {error && (
        <div className="text-[#1C1C1E] text-sm font-semibold p-4 rounded-2xl mb-4 bg-[#F2F2F7] border border-[#E5E5EA]">{error}</div>
      )}

      <button
        onClick={() => router.push('/send')}
        className="w-full py-4 rounded-2xl text-sm font-semibold text-[#1C1C1E] bg-[#F2F2F7] border border-[#E5E5EA] hover:bg-[#E5E5EA] transition-colors"
      >
        Enter address manually instead
      </button>
    </div>
  );
}
