// app/page.js
'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useWallet } from './components/WalletProvider';
import SlideToStart from './components/landing/SlideToStart';

// Dynamic import with SSR disabled for WebGL DitherVeil component
const DitherVeil = dynamic(() => import('./components/reactbits/DitherVeil'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#0D1017] text-[#94A3B8] text-xs">
      Loading globe...
    </div>
  ),
});

export default function MobileLandingPage() {
  const router = useRouter();
  const { wallet } = useWallet();

  const handleStart = () => {
    if (wallet) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#0D1017] text-white flex flex-col justify-between max-w-md mx-auto px-6 py-6 sm:py-8 select-none relative overflow-hidden">
      
      {/* =========================================================================
          TOP MOBILE BAR: Wordmark & Ambassador Mascot Avatar
          ========================================================================= */}
      <header className="w-full flex items-center justify-between z-20">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black font-display tracking-tight text-white">migo.</span>
        </div>

        {/* Dinosaur Ambassador Avatar */}
        <div
          onClick={handleStart}
          className="w-10 h-10 rounded-full border border-[#262E3D] bg-[#161B26] overflow-hidden cursor-pointer hover:border-[#7C3AED] transition-colors shrink-0 flex items-center justify-center shadow-sm"
          title="Migo Ambassador"
        >
          <img src="/ambassador.png" alt="Migo Ambassador" className="w-full h-full object-cover" />
        </div>
      </header>

      {/* =========================================================================
          CENTER HERO: Punchy Headline + Interactive Dithered Globe
          ========================================================================= */}
      <main className="flex-1 flex flex-col items-center justify-center my-auto py-4 z-10">
        
        {/* Mobile Headline */}
        <div className="text-center mb-6 px-1">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-[1.12] font-display">
            Move Money Across Borders in <span className="text-[#7C3AED]">3 Seconds</span>.
          </h1>
          <p className="text-xs sm:text-sm text-[#94A3B8] mt-2 max-w-xs mx-auto leading-relaxed">
            Non-custodial peer-to-peer remittance powered directly by the XRP Ledger.
          </p>
        </div>

        {/* Circular Dithered Globe Centerpiece */}
        <div className="relative w-[270px] h-[270px] sm:w-[310px] sm:h-[310px] flex items-center justify-center my-2">
          
          {/* Globe Aperture Frame */}
          <div className="w-full h-full rounded-full border-2 border-[#262E3D] bg-[#0D1017] overflow-hidden shadow-2xl relative cursor-crosshair">
            <DitherVeil
              src="/globe.jpg"
              pattern="floyd"
              pixelSize={2}
              levels={2}
              palette="duotone"
              inkColor="#0D1017"
              paperColor="#E2E8F0"
              rimColor="#7C3AED"
              rim={0.2}
              revealRadius={140}
              softness={0.6}
              linger={1.2}
              contrast={1.25}
              brightness={0.05}
              clickBurst={true}
              wander={true}
              fit="cover"
              className="w-full h-full"
            />
          </div>

          {/* Floating Currency Nodes Around the Globe */}
          <div className="absolute -top-2 left-1 px-2.5 py-1 rounded-xl bg-[#161B26] border border-[#262E3D] text-[11px] font-bold text-white shadow-md pointer-events-none">
            <span>USD · $</span>
          </div>

          <div className="absolute top-4 -right-2 px-2.5 py-1 rounded-xl bg-[#161B26] border border-[#262E3D] text-[11px] font-bold text-white shadow-md pointer-events-none">
            <span>EUR · €</span>
          </div>

          <div className="absolute bottom-5 -left-3 px-2.5 py-1 rounded-xl bg-[#161B26] border border-[#262E3D] text-[11px] font-bold text-white shadow-md pointer-events-none">
            <span>INR · ₹</span>
          </div>

          <div className="absolute -bottom-2 right-1 px-2.5 py-1 rounded-xl bg-[#161B26] border border-[#262E3D] text-[11px] font-bold text-white shadow-md pointer-events-none">
            <span>NGN · ₦</span>
          </div>
        </div>

      </main>

      {/* =========================================================================
          BOTTOM THUMB ZONE: Sliding Button + Secondary Login Link
          ========================================================================= */}
      <footer className="w-full flex flex-col gap-3 pt-2 z-20">
        
        {/* Slide To Get Started Button */}
        <SlideToStart className="w-full" />

        {/* Secondary Navigation Row */}
        <div className="flex items-center justify-between text-xs text-[#94A3B8] px-3 pt-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            AES-256 Vault
          </span>
          <button
            onClick={handleStart}
            className="text-xs font-semibold text-white hover:text-[#7C3AED] transition-colors"
          >
            {wallet ? 'Open Wallet →' : 'Existing User? Log In →'}
          </button>
        </div>

      </footer>

    </div>
  );
}
