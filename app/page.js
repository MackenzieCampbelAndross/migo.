// app/page.js
'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from './components/WalletProvider';
import dynamic from 'next/dynamic';

const Globe = dynamic(() => import('./components/Globe'), { ssr: false });

// Floating transfer popup — shows 1-2 at a time
function TransferPopup({ transfer, position }) {
  return (
    <div
      className={`absolute ${position} animate-fade-in-out pointer-events-none z-20`}
    >
      <div className="bg-[#FFFFFF]/95 border border-[#E5E5EA] rounded-2xl px-3.5 py-2.5 max-w-[170px] shadow-sm">
        <div className="flex items-center gap-1.5 mb-0.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#000000]" />
          <span className="text-[10px] text-[#8E8E93] truncate">{transfer.from}</span>
          <span className="text-[10px] text-[#A1A1A6]">→</span>
          <span className="text-[10px] text-[#8E8E93] truncate">{transfer.to}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold text-[#1C1C1E]">{transfer.amt}</span>
          <span className="text-[9px] text-[#636366] font-medium ml-2">{transfer.cur}</span>
        </div>
      </div>
    </div>
  );
}

const DEMO_TRANSFERS = [
  { from: 'Kansas City', to: 'New Delhi', amt: '$1,200', cur: 'USD → INR' },
  { from: 'London', to: 'Lagos', amt: '£800', cur: 'GBP → NGN' },
  { from: 'Tokyo', to: 'São Paulo', amt: '¥50,000', cur: 'JPY → BRL' },
  { from: 'Dubai', to: 'Karachi', amt: 'AED 2,000', cur: 'AED → PKR' },
  { from: 'New York', to: 'London', amt: '$3,500', cur: 'USD → GBP' },
  { from: 'Paris', to: 'Nairobi', amt: '€1,800', cur: 'EUR → KES' },
  { from: 'Singapore', to: 'Mumbai', amt: 'S$950', cur: 'SGD → INR' },
  { from: 'Chicago', to: 'Bangalore', amt: '$4,200', cur: 'USD → INR' },
];

const POPUP_POSITIONS = [
  'top-[15%] left-3',
  'top-[35%] right-3',
  'top-[55%] left-4',
  'top-[25%] right-4',
];

export default function Home() {
  const { wallet, loading, login } = useWallet();
  const router = useRouter();
  const [mode, setMode] = useState(null); // null | 'create' | 'import'
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [createdSeed, setCreatedSeed] = useState('');
  const [popups, setPopups] = useState([]);
  const popupIdx = useRef(0);

  useEffect(() => {
    if (!loading && wallet) router.push('/dashboard');
  }, [loading, wallet, router]);

  // Cycle through demo transfers, show 1 at a time
  useEffect(() => {
    const show = () => {
      const transfer = DEMO_TRANSFERS[popupIdx.current % DEMO_TRANSFERS.length];
      const position = POPUP_POSITIONS[popupIdx.current % POPUP_POSITIONS.length];
      const id = Date.now();
      popupIdx.current++;
      setPopups(prev => [...prev.slice(-1), { ...transfer, id, position }]);
      setTimeout(() => setPopups(prev => prev.filter(p => p.id !== id)), 7000);
    };
    show();
    const interval = setInterval(show, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async () => {
    setWorking(true);
    setError('');
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, baseCurrency: currency, username }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setCreatedSeed(data.seed);
      login(data.address, data.seed, data.username, data.baseCurrency || currency);
    } catch (err) {
      setError(err.message);
    }
    setWorking(false);
  };

  const handleImport = async () => {
    setWorking(true);
    setError('');
    try {
      const res = await fetch('/api/wallet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, displayName: name, baseCurrency: currency, username }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      login(data.address, seed, data.username, data.baseCurrency || currency);
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    }
    setWorking(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F8F8FA]">
        <div className="w-10 h-10 border-3 border-[#E5E5EA] border-t-[#000000] rounded-full animate-spin" />
      </div>
    );
  }

  // Seed backup screen
  if (createdSeed) {
    return (
      <div className="min-h-screen bg-[#F8F8FA] px-6 pt-16 max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[#FFFFFF] border border-[#E5E5EA] rounded-full flex items-center justify-center text-[#1C1C1E] mx-auto mb-3 shadow-sm">
            <svg className="w-6 h-6 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0v4" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1E]">Save Your Wallet Seed</h2>
          <p className="text-sm text-[#8E8E93] mt-2">
            This is the ONLY way to recover your wallet. Save it somewhere safe.
          </p>
        </div>
        <div className="card rounded-2xl p-4 mb-6 bg-[#F2F2F7]">
          <code className="text-sm text-[#000000] break-all select-all font-mono font-semibold">{createdSeed}</code>
        </div>
        <button
          onClick={() => { navigator.clipboard?.writeText(createdSeed); }}
          className="w-full py-3 card text-[#1C1C1E] rounded-2xl text-sm font-medium mb-3"
        >
          Copy to Clipboard
        </button>
        <button
          onClick={() => router.push('/dashboard')}
          className="w-full py-3.5 bg-[#000000] text-white rounded-2xl font-bold active:opacity-90"
        >
          I Saved It — Continue
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#F8F8FA] flex flex-col">
      {/* Title — clean Migo. branding */}
      <div className="text-center pt-12 pb-3 flex-shrink-0 relative z-10">
        <h1 className="text-4xl font-extrabold text-[#1C1C1E] tracking-tight">
          Migo.
        </h1>
        <p className="text-[#8E8E93] text-sm mt-1 font-medium">Send money anywhere. Instantly.</p>
      </div>

      {/* Globe — fills middle space, interactive */}
      <div className="flex-1 relative min-h-0">
        <Globe />
        {/* Floating transaction popups */}
        {popups.map(p => (
          <TransferPopup key={p.id} transfer={p} position={p.position} />
        ))}
      </div>

      {/* Bottom wallet panel */}
      <div className="flex-shrink-0 px-5 pt-4 pb-8 safe-bottom relative z-10">
        {/* Mode selection */}
        {!mode && (
          <div className="space-y-3">
            <button
              onClick={() => setMode('create')}
              className="w-full py-4 bg-[#000000] text-white rounded-2xl font-semibold text-base active:scale-[0.98] transition-transform shadow-sm"
            >
              Create New Wallet
            </button>
            <button
              onClick={() => setMode('import')}
              className="w-full py-4 card text-[#1C1C1E] rounded-2xl font-semibold text-base active:opacity-80 transition-colors"
            >
              I Have a Wallet
            </button>
            <p className="text-center text-[11px] text-[#8E8E93] mt-3 font-medium">
              Powered by the XRP Ledger
            </p>
          </div>
        )}

        {/* Create form */}
        {mode === 'create' && (
          <div className="space-y-3">
            <button onClick={() => setMode(null)} className="text-sm font-semibold text-[#1C1C1E] mb-1">← Back</button>
            <div>
              <label className="text-xs text-[#8E8E93] mb-1 block uppercase tracking-wider font-semibold">Username</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]">@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  placeholder="jayp"
                  maxLength={20}
                  className="input-field w-full pl-9 pr-4 py-3 rounded-2xl text-sm"
                />
              </div>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="input-field w-full px-4 py-3 rounded-2xl text-sm"
            />
            <div>
              <label className="text-xs text-[#8E8E93] mb-1 block uppercase tracking-wider font-semibold">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="input-field w-full px-4 py-3 rounded-2xl text-sm"
              >
                <option value="USD">USD — US Dollar</option>
                <option value="INR">INR — Indian Rupee</option>
                <option value="EUR">EUR — Euro</option>
                <option value="NGN">NGN — Nigerian Naira</option>
              </select>
            </div>
            {error && <p className="text-[#1C1C1E] text-sm font-semibold">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={working || !username || username.length < 3}
              className="w-full py-4 bg-[#000000] text-white rounded-2xl font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              {working ? 'Creating wallet (30-60s)...' : 'Create Wallet'}
            </button>
          </div>
        )}

        {/* Import form */}
        {mode === 'import' && (
          <div className="space-y-3">
            <button onClick={() => setMode(null)} className="text-sm font-semibold text-[#1C1C1E] mb-1">← Back</button>
            <div>
              <label className="text-xs text-[#8E8E93] mb-1 block uppercase tracking-wider font-semibold">Wallet Seed</label>
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="sEdXXXXXXXXXXXXXXXX..."
                className="input-field w-full px-4 py-3 rounded-2xl font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-[#8E8E93] mb-1 block uppercase tracking-wider font-semibold">Username (if first time)</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]">@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  placeholder="jayp"
                  maxLength={20}
                  className="input-field w-full pl-9 pr-4 py-3 rounded-2xl text-sm"
                />
              </div>
            </div>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="input-field w-full px-4 py-3 rounded-2xl text-sm"
            >
              <option value="USD">USD — US Dollar</option>
              <option value="INR">INR — Indian Rupee</option>
              <option value="EUR">EUR — Euro</option>
              <option value="NGN">NGN — Nigerian Naira</option>
            </select>
            {error && <p className="text-[#1C1C1E] text-sm font-semibold">{error}</p>}
            <button
              onClick={handleImport}
              disabled={working || !seed}
              className="w-full py-4 bg-[#000000] text-white rounded-2xl font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              {working ? 'Importing...' : 'Import Wallet'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

