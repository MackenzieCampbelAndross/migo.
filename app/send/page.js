// app/send/page.js
'use client';
import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch, newIdempotencyKey } from '@/lib/client-api';
import dynamic from 'next/dynamic';

const TransferGlobe = dynamic(() => import('../components/TransferGlobe'), { ssr: false });

const CURRENCY_SYMBOLS = { USD: '$', INR: '₹', EUR: '€', NGN: '₦' };

function SendInner() {
  const { wallet, loading: walletLoading } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!walletLoading && !wallet) router.push('/');
  }, [walletLoading, wallet, router]);

  const [dest, setDest] = useState(searchParams.get('to') || '');
  const [resolvedUser, setResolvedUser] = useState(null);
  const [amount, setAmount] = useState(searchParams.get('amount') || '');
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState(searchParams.get('currency') || 'INR');
  const [rate, setRate] = useState(null);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [showGlobe, setShowGlobe] = useState(false);
  const [globeDone, setGlobeDone] = useState(false);
  const sendKeyRef = useRef(null);

  useEffect(() => {
    sendKeyRef.current = newIdempotencyKey();
  }, [dest, amount, fromCurrency, toCurrency]);

  // Resolve @username to wallet address
  const resolveRecipient = async () => {
    const value = dest.trim();
    if (!value) return;
    if (!value.startsWith('r')) {
      const username = value.replace(/^@/, '');
      setLookingUp(true);
      try {
        const data = await apiFetch(`/api/user?username=${encodeURIComponent(username)}`);
        if (data.success) {
          setResolvedUser(data.user);
          setDest(data.user.address);
          setError('');
        }
      } catch (err) {
        setResolvedUser(null);
        setError(err.message || 'Lookup failed');
      }
      setLookingUp(false);
    } else {
      setResolvedUser(null);
    }
  };

  const checkRate = async () => {
    setError('');
    try {
      const data = await apiFetch(
        `/api/payment?fromCurrency=${fromCurrency}&toCurrency=${toCurrency}&amount=${encodeURIComponent(amount)}&recipient=${encodeURIComponent(dest)}`
      );
      setRate(data);
    } catch (err) {
      setError(err.message || 'Failed to get rate');
    }
  };

  const handleSend = async () => {
    setSending(true);
    setShowGlobe(true);
    setGlobeDone(false);
    setError('');
    try {
      const data = await apiFetch('/api/payment', {
        method: 'POST',
        body: JSON.stringify({
          to: dest,
          amount,
          fromCurrency,
          toCurrency,
          idempotencyKey: sendKeyRef.current || newIdempotencyKey(),
        }),
      });
      setReceipt(data);
      sendKeyRef.current = newIdempotencyKey();
    } catch (err) {
      // Keep the key only when the outcome is unknown, so a resend can't double-pay.
      if (err.status && !/being processed/i.test(err.message || '')) sendKeyRef.current = newIdempotencyKey();
      setError(err.message || 'Payment failed');
      setShowGlobe(false);
    }
    setSending(false);
  };

  if (!wallet) return <div className="flex items-center justify-center h-full min-h-[400px] text-[#8E8E93]">Loading...</div>;

  // Globe animation screen (shows during/after payment)
  if (showGlobe && !globeDone) {
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#F5F5F7]">
        <div className="w-full h-[60%]">
          <TransferGlobe
            fromCurrency={fromCurrency}
            toCurrency={toCurrency}
            onComplete={() => setTimeout(() => setGlobeDone(true), 1200)}
          />
        </div>
        <div className="text-center mt-4 animate-slide-up px-4">
          <p className="text-[#8E8E93] text-xs mb-1 font-semibold uppercase tracking-wider">Sending money via XRPL</p>
          <p className="text-[#1C1C1E] text-2xl font-bold">{amount} {fromCurrency}</p>
          <p className="text-[#8E8E93] text-xs mt-2 font-medium">Settlement in ~3 seconds</p>
        </div>
      </div>
    );
  }

  // Receipt screen
  if (receipt && globeDone) {
    return (
      <div className="px-5 pt-6 pb-20 w-full animate-slide-up">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-[#FFFFFF] border border-[#E5E5EA] mx-auto flex items-center justify-center text-[#1C1C1E] shadow-sm mb-3">
            <svg className="w-6 h-6 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[#1C1C1E]">Payment Sent</h2>
        </div>
        <div className="bg-[#FFFFFF]/90 backdrop-blur-md rounded-[24px] p-6 space-y-3.5 border border-[#E5E5EA] shadow-sm">
          <div className="flex justify-between text-sm">
            <span className="text-[#8E8E93]">You sent</span>
            <span className="font-semibold text-[#1C1C1E]">{receipt.amountSent} {receipt.currencySent}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#8E8E93]">They received</span>
            <span className="font-extrabold text-[#1C1C1E]">{receipt.amountReceived} {receipt.currencyReceived}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#8E8E93]">Rate</span>
            <span className="text-[#1C1C1E] font-medium">1 {receipt.currencySent} = {receipt.effectiveRate} {receipt.currencyReceived}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#8E8E93]">Fee</span>
            <span className="font-semibold text-[#1C1C1E]">{receipt.fee}</span>
          </div>
          <div className="border-t border-[#E5E5EA] pt-3 mt-2">
            <a
              href={receipt.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-[#1C1C1E] text-xs font-semibold hover:underline"
            >
              View on XRPL Explorer →
            </a>
          </div>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="w-full mt-6 py-4 rounded-2xl font-semibold bg-[#000000] text-white shadow-sm active:scale-[0.99] transition-all"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-20 w-full">
      {/* Top Header */}
      <header className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="w-10 h-10 rounded-full bg-[#FFFFFF] border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] shadow-sm hover:bg-[#F2F2F7] active:scale-95 transition-all"
        >
          <svg className="w-4 h-4 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl font-bold tracking-tight text-[#1C1C1E]">Migo.</span>
        <div className="w-10"></div>
      </header>

      <h2 className="text-2xl font-bold tracking-tight text-[#1C1C1E]">Send Money</h2>
      <p className="text-xs text-[#8E8E93] mt-1 mb-6 font-medium">Send money across borders. Instantly.</p>

      <div className="space-y-4">
        <div>
          <label className="text-[11px] text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">Recipient (@username or address)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8E8E93]">
              <svg className="w-4 h-4 text-[#8E8E93]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </span>
            <input
              value={resolvedUser ? `@${resolvedUser.username}` : dest}
              onChange={(e) => { setDest(e.target.value); setResolvedUser(null); setRate(null); }}
              onBlur={resolveRecipient}
              onKeyDown={(e) => e.key === 'Enter' && resolveRecipient()}
              placeholder="@jayp or rXXXXXXXXX..."
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors font-medium"
            />
          </div>
          {lookingUp && <p className="text-xs text-[#8E8E93] mt-1.5 animate-pulse font-medium">Looking up user...</p>}
          {resolvedUser && (
            <p className="text-xs text-[#1C1C1E] font-semibold mt-1.5">
              ✓ {resolvedUser.displayName || resolvedUser.username} — <span className="font-mono text-[#8E8E93] font-normal">{resolvedUser.address.slice(0, 12)}...</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">You send</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setRate(null); }}
              placeholder="50.00"
              className="w-full px-4 py-3.5 rounded-2xl input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E] font-semibold text-sm focus:outline-none focus:border-[#000000]"
            />
          </div>
          <div>
            <label className="text-[11px] text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">Currency</label>
            <select
              value={fromCurrency}
              onChange={(e) => { setFromCurrency(e.target.value); setRate(null); }}
              className="w-full px-4 py-3.5 rounded-2xl input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E] font-semibold text-sm focus:outline-none focus:border-[#000000]"
            >
              <option value="USD">USD</option>
              <option value="INR">INR</option>
              <option value="EUR">EUR</option>
              <option value="NGN">NGN</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">They receive in</label>
          <select
            value={toCurrency}
            onChange={(e) => { setToCurrency(e.target.value); setRate(null); }}
            className="w-full px-4 py-3.5 rounded-2xl input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E] font-semibold text-sm focus:outline-none focus:border-[#000000]"
          >
            <option value="USD">USD</option>
            <option value="INR">INR</option>
            <option value="EUR">EUR</option>
            <option value="NGN">NGN</option>
          </select>
        </div>

        {/* Rate preview */}
        {!rate && amount && dest && (
          <button
            onClick={checkRate}
            className="w-full py-3.5 rounded-2xl font-semibold text-xs uppercase tracking-wider text-[#1C1C1E] bg-[#E5E5EA] hover:bg-[#D1D1D6] transition-colors mt-2"
          >
            Check Rate
          </button>
        )}

        {rate && (
          <div className="bg-[#FFFFFF]/90 backdrop-blur-md border border-[#E5E5EA] rounded-[24px] p-5 space-y-2.5 shadow-sm mt-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#8E8E93]">They receive (est.)</span>
              <span className="font-extrabold text-base text-[#1C1C1E]">~{parseFloat(rate.estimatedReceive).toFixed(2)} {toCurrency}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8E8E93]">Rate</span>
              <span className="text-[#1C1C1E] font-medium">1 {fromCurrency} = {Number(rate.rate).toFixed(2)} {toCurrency}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8E8E93]">Minimum received</span>
              <span className="font-semibold text-[#1C1C1E]">{parseFloat(rate.minReceived).toFixed(2)} {toCurrency}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8E8E93]">Migo fee</span>
              <span className="font-semibold text-[#1C1C1E]">{rate.fee}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8E8E93]">Network fee</span>
              <span className="text-[#636366]">{rate.networkFee}</span>
            </div>
            <div className="border-t border-[#E5E5EA] pt-2.5 mt-2">
              <p className="text-[10px] text-[#8E8E93] font-semibold mb-1.5 uppercase tracking-wider">
                Estimated comparison for {amount} {fromCurrency} ({rate.rateSource === 'pathfind' ? 'live testnet AMM/DEX' : 'fallback rate'}):
              </p>
              <div className="text-xs space-y-1.5">
                <div className="flex justify-between text-[#8E8E93]"><span>Western Union</span><span className="text-[#636366]">~${rate.competitors.westernUnion.total} in fees</span></div>
                <div className="flex justify-between text-[#8E8E93]"><span>Wise</span><span className="text-[#636366]">~${rate.competitors.wise.total} in fees</span></div>
                <div className="flex justify-between text-[#8E8E93]"><span>Bank Wire</span><span className="text-[#636366]">~${rate.competitors.bankWire.total} in fees</span></div>
                <div className="flex justify-between font-bold text-[#1C1C1E] pt-1.5 border-t border-[#E5E5EA]"><span>Migo</span><span className="text-[#1C1C1E]">{CURRENCY_SYMBOLS[fromCurrency]}{rate.competitors.remitx.total} in fees</span></div>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-[#1C1C1E] text-xs font-semibold p-3.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl">{error}</p>}

        {rate ? (
          <button
            onClick={handleSend}
            disabled={sending}
            className="w-full py-4 rounded-2xl font-semibold text-sm disabled:opacity-40 bg-[#000000] text-white shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2"
          >
            {sending ? 'Sending...' : `Send Money →`}
          </button>
        ) : (!amount || !dest) ? (
          <button
            onClick={handleSend}
            disabled={true}
            className="w-full py-4 rounded-2xl font-semibold text-sm opacity-40 bg-[#000000] text-white flex items-center justify-center gap-2 mt-2"
          >
            Send Money →
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function Send() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[400px] text-[#8E8E93]">Loading...</div>}>
      <SendInner />
    </Suspense>
  );
}
