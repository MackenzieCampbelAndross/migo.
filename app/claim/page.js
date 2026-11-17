'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch } from '@/lib/client-api';
import { normalizeClaimCode } from '@/lib/claim-code-format';

export default function Claim() {
  const router = useRouter();
  const { wallet, loading } = useWallet();
  const [code, setCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const codeComplete = normalizeClaimCode(code).length === 10;

  const handleClaim = async () => {
    setClaiming(true);
    setError('');
    try {
      const data = await apiFetch('/api/escrow', {
        method: 'PUT',
        body: JSON.stringify({ code }),
      });
      setResult(data);
    } catch (err) {
      setError(err.message || 'Failed to claim');
    }
    setClaiming(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-[#8E8E93] text-sm">Loading...</div>;
  }

  if (!wallet) {
    return (
      <div className="px-5 pt-16 max-w-md mx-auto text-center">
        <p className="text-sm text-[#8E8E93] mb-4">Create or import a wallet before claiming funds.</p>
        <button
          onClick={() => router.push('/')}
          className="w-full py-4 rounded-2xl font-semibold bg-[#000000] text-white"
        >
          Go to wallet setup
        </button>
      </div>
    );
  }

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
          <h2 className="text-xl font-bold text-[#1C1C1E]">Funds Claimed</h2>
          <p className="text-[#1C1C1E] text-xl font-extrabold mt-2">
            {result.amount} {result.currency || 'USD'} received
          </p>
        </div>

        {result.explorerUrl && (
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
        <h1 className="text-2xl font-bold text-[#1C1C1E]">Migo Claim</h1>
        <p className="text-sm text-[#8E8E93] mt-2">Enter the 10-character code to receive funds.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block text-center">
            Claim code
          </label>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 11))}
            placeholder="XXXXX-XXXXX"
            maxLength={11}
            autoComplete="off"
            spellCheck={false}
            className="w-full px-4 py-4 rounded-2xl text-center font-mono text-xl font-bold tracking-[0.2em] bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
          />
        </div>

        {error && <p className="text-[#1C1C1E] font-semibold text-sm bg-[#F2F2F7] border border-[#E5E5EA] p-3 rounded-xl">{error}</p>}

        <button
          onClick={handleClaim}
          disabled={claiming || !codeComplete}
          className="w-full py-4 rounded-2xl font-semibold bg-[#000000] text-white hover:bg-[#1C1C1E] disabled:opacity-40 transition-all shadow-sm"
        >
          {claiming ? 'Claiming...' : 'Claim Funds'}
        </button>

        <p className="text-[11px] text-[#8E8E93] text-center leading-relaxed">
          Claim codes are only valid on the XRPL testnet. Never share a wallet seed.
        </p>
      </div>
    </div>
  );
}
