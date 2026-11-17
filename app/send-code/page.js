// app/send-code/page.js
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch, newIdempotencyKey } from '@/lib/client-api';

export default function SendCode() {
  const { wallet, loading: walletLoading } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!walletLoading && !wallet) router.push('/');
  }, [walletLoading, wallet, router]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [creating, setCreating] = useState(false);
  const [escrow, setEscrow] = useState(null); // { code, expiresAt, amount }
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const createKeyRef = useRef(null);

  useEffect(() => {
    createKeyRef.current = newIdempotencyKey();
  }, [amount, currency, recipientUsername]);

  // Countdown timer
  useEffect(() => {
    if (!escrow) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(escrow.expiresAt) - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [escrow]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const data = await apiFetch('/api/escrow', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          currency,
          to: recipientUsername.trim() || undefined,
          idempotencyKey: createKeyRef.current || newIdempotencyKey(),
          cancelSeconds: 300,
        }),
      });
      if (data.success) {
        setEscrow(data);
        createKeyRef.current = newIdempotencyKey();
      }
    } catch (err) {
      setError(err.message || 'Failed to create escrow');
    }
    setCreating(false);
  };

  if (!wallet) return <div className="flex items-center justify-center h-screen text-[#8E8E93]">Loading...</div>;

  // Show code screen
  if (escrow) {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;

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
            <svg className="w-6 h-6 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1E]">Share This Code</h2>
          <p className="text-sm text-[#8E8E93] mt-1">
            {escrow.recipientUsername
              ? <>Share this code with <span className="font-semibold text-[#1C1C1E]">@{escrow.recipientUsername}</span>. It also appears in their pending claims.</>
              : <>Recipient enters this at <span className="font-mono text-[#1C1C1E]">/claim</span></>}
          </p>
        </div>

        <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-3xl p-6 text-center mb-6 shadow-sm">
          <p className="font-mono font-bold text-[#1C1C1E] mb-2 text-2xl tracking-wider break-all">
            {escrow.code}
          </p>
          <p className="text-[10px] text-[#8E8E93] uppercase tracking-wider font-semibold mb-3">
            10-character claim code
          </p>
          <p className="text-sm text-[#8E8E93]">
            {timeLeft > 0 ? (
              <>Expires in <span className="font-mono font-semibold text-[#1C1C1E]">{mins}:{secs.toString().padStart(2, '0')}</span></>
            ) : (
              <span className="text-[#636366] font-semibold">Expired — refund available in your history</span>
            )}
          </p>
          <p className="text-xl font-bold text-[#1C1C1E] mt-3">{escrow.displayAmount} {escrow.currency}</p>
        </div>

        <button
          onClick={() => { navigator.clipboard?.writeText(escrow.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="w-full py-3.5 rounded-2xl text-sm font-semibold mb-3 text-[#1C1C1E] bg-[#E5E5EA] hover:bg-[#D1D1D6] transition-colors"
        >
          {copied ? '✓ Code Copied' : 'Copy Code'}
        </button>

        <button
          onClick={() => router.push('/dashboard')}
          className="w-full py-4 rounded-2xl font-semibold bg-[#000000] text-white hover:bg-[#1C1C1E] transition-all"
        >
          Done
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

      <h2 className="text-2xl font-bold text-[#1C1C1E] mb-1">Send via Code</h2>
      <p className="text-sm text-[#8E8E93] mb-6">
        Generate a secure code. Share it with anyone or specify a username.
      </p>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block">Recipient username (optional)</label>
          <input
            value={recipientUsername}
            onChange={(e) => setRecipientUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
            placeholder="e.g. jayp"
            className="w-full px-4 py-3.5 rounded-2xl text-sm bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
          />
          <p className="text-xs text-[#8E8E93] mt-1.5">Leave blank to send to anyone with the code.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50.00"
              className="w-full px-4 py-3.5 rounded-2xl text-sm bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl text-sm bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
            >
              <option value="USD">USD</option>
              <option value="INR">INR</option>
              <option value="EUR">EUR</option>
              <option value="NGN">NGN</option>
            </select>
          </div>
          <p className="text-xs text-[#8E8E93] col-span-2">Funds are held for 5 minutes. If unclaimed, the sender can refund from history after expiry.</p>
        </div>

        {error && <p className="text-[#1C1C1E] font-semibold text-sm bg-[#F2F2F7] border border-[#E5E5EA] p-3 rounded-xl">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={creating || !amount}
          className="w-full py-4 bg-[#000000] text-white hover:bg-[#1C1C1E] rounded-2xl font-semibold disabled:opacity-40 transition-all shadow-sm"
        >
          {creating ? 'Creating escrow...' : 'Generate Code'}
        </button>
      </div>
    </div>
  );
}
