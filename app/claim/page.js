// app/claim/page.js
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Claim() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [seed, setSeed] = useState('');
  const [mode, setMode] = useState('existing'); // 'existing' or 'new'
  const [claiming, setClaiming] = useState(false);
  const [result, setResult] = useState(null);
  const [newWallet, setNewWallet] = useState(null);
  const [error, setError] = useState('');

  const createWalletFirst = async () => {
    setClaiming(true);
    setError('');
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseCurrency: 'USD' }),
      });
      const data = await res.json();
      if (data.success) {
        setNewWallet(data);
        setSeed(data.seed);
      } else throw new Error(data.error);
    } catch (e) { setError(e.message); }
    setClaiming(false);
  };

  const handleClaim = async () => {
    setClaiming(true);
    setError('');
    try {
      const res = await fetch('/api/escrow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), claimerSeed: seed.trim() }),
      });
      const data = await res.json();
      if (data.success) setResult(data);
      else setError(data.error || 'Failed to claim');
    } catch (e) { setError('Claim failed'); }
    setClaiming(false);
  };

  // Success screen
  if (result) {
    return (
      <div className="px-4 pt-4 pb-12 max-w-md mx-auto">
        <header className="flex items-center justify-between mb-6">
          <button onClick={() => router.push('/dashboard')} className="w-9 h-9 rounded-full bg-[#F2F2F7] flex items-center justify-center text-[#1C1C1E] text-base hover:bg-[#E5E5EA] transition-colors">
            ←
          </button>
          <span className="text-xl font-bold tracking-tight text-[#1C1C1E]">Migo.</span>
          <div className="w-9"></div>
        </header>

        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-[#FFFFFF] border border-[#E5E5EA] rounded-full flex items-center justify-center text-[#1C1C1E] mx-auto mb-3 shadow-sm">
            <svg className="w-6 h-6 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1E]">Funds Claimed!</h2>
          <p className="text-[#1C1C1E] text-xl font-extrabold mt-2">{result.amount} {result.currency || 'USD'} received</p>
        </div>
        <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl p-4 mb-4">
          <a
            href={result.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#1C1C1E] text-sm font-semibold underline block text-center"
          >
            View on XRPL Explorer →
          </a>
        </div>
        {newWallet && (
          <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl p-4 mt-4">
            <p className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2">Your new wallet seed (save this!):</p>
            <code className="text-xs font-mono text-[#1C1C1E] break-all select-all font-bold">{newWallet.seed}</code>
          </div>
        )}

        <button
          onClick={() => router.push('/dashboard')}
          className="w-full mt-6 py-4 rounded-2xl font-semibold bg-[#000000] text-white hover:bg-[#1C1C1E] transition-all"
        >
          Go to Dashboard
        </button>
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

      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-[#1C1C1E]">
          Migo Claim
        </h1>
        <p className="text-sm text-[#8E8E93] mt-2">Enter your 6-digit code to receive funds.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block text-center">6-digit claim code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="847291"
            maxLength={6}
            className="w-full px-4 py-4 rounded-2xl text-center font-mono text-2xl font-bold tracking-[0.3em] bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
          />
        </div>

        {/* Wallet selection */}
        <div className="flex gap-2 p-1 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl">
          <button
            onClick={() => setMode('existing')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${mode === 'existing' ? 'bg-[#000000] text-white shadow-sm' : 'text-[#8E8E93] hover:text-[#1C1C1E]'}`}
          >
            I have a wallet
          </button>
          <button
            onClick={() => { setMode('new'); if (!newWallet) createWalletFirst(); }}
            className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${mode === 'new' ? 'bg-[#000000] text-white shadow-sm' : 'text-[#8E8E93] hover:text-[#1C1C1E]'}`}
          >
            Create new wallet
          </button>
        </div>

        {mode === 'existing' && (
          <div>
            <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-1.5 block">Wallet Seed</label>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Your wallet seed (sEdXXX...)"
              className="w-full px-4 py-3.5 rounded-2xl font-mono text-xs bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
            />
          </div>
        )}

        {mode === 'new' && newWallet && (
          <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl p-4">
            <p className="text-xs font-semibold text-[#1C1C1E]">✓ Wallet created: <span className="font-mono text-[#8E8E93]">{newWallet.address.slice(0, 12)}...</span></p>
          </div>
        )}

        {error && <p className="text-[#1C1C1E] font-semibold text-sm bg-[#F2F2F7] border border-[#E5E5EA] p-3 rounded-xl">{error}</p>}

        <button
          onClick={handleClaim}
          disabled={claiming || code.length !== 6 || !seed}
          className="w-full py-4 rounded-2xl font-semibold bg-[#000000] text-white hover:bg-[#1C1C1E] disabled:opacity-40 transition-all shadow-sm"
        >
          {claiming ? 'Claiming...' : 'Claim Funds'}
        </button>
      </div>
    </div>
  );
}
