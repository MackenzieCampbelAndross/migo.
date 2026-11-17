// app/send/page.js
'use client';
import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch, newIdempotencyKey } from '@/lib/client-api';
import dynamic from 'next/dynamic';
import GlideSelect from '../components/reactbits/GlideSelect';
import SlideCommit from '../components/reactbits/SlideCommit';

const TransferGlobe = dynamic(() => import('../components/TransferGlobe'), { ssr: false });

const CURRENCY_SYMBOLS = { USD: '$', INR: '₹', EUR: '€', NGN: '₦' };

const SEND_CURRENCIES = [
  { value: 'USD', label: 'USD ($)', tag: 'US Dollar' },
  { value: 'INR', label: 'INR (₹)', tag: 'Indian Rupee' },
  { value: 'EUR', label: 'EUR (€)', tag: 'Euro' },
  { value: 'NGN', label: 'NGN (₦)', tag: 'Nigerian Naira' },
];

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
      return data;
    } catch (err) {
      if (err.status && !/being processed/i.test(err.message || '')) sendKeyRef.current = newIdempotencyKey();
      setError(err.message || 'Payment failed');
      setShowGlobe(false);
      throw err;
    } finally {
      setSending(false);
    }
  };

  if (!wallet) return <div className="flex items-center justify-center h-full min-h-[400px] text-[#94A3B8]">Loading...</div>;

  // Globe animation screen
  if (showGlobe && !globeDone) {
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#0D1017]">
        <div className="w-full h-[60%]">
          <TransferGlobe
            fromCurrency={fromCurrency}
            toCurrency={toCurrency}
            onComplete={() => setTimeout(() => setGlobeDone(true), 1200)}
          />
        </div>
        <div className="text-center mt-4 animate-slide-up px-4">
          <p className="text-[#94A3B8] text-xs mb-1 font-semibold uppercase tracking-wider">Sending money via XRPL</p>
          <p className="text-white text-2xl font-bold">{amount} {fromCurrency}</p>
          <p className="text-[#94A3B8] text-xs mt-2 font-medium">Settlement in ~3 seconds</p>
        </div>
      </div>
    );
  }

  // Receipt screen
  if (receipt && globeDone) {
    return (
      <div className="px-5 pt-6 pb-20 w-full max-w-md mx-auto min-h-screen bg-[#0D1017] text-white animate-slide-up">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-[#161B26] border border-[#262E3D] mx-auto flex items-center justify-center text-white shadow-sm mb-3">
            <svg className="w-6 h-6 text-[#7C3AED]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">Payment Sent</h2>
        </div>
        <div className="bg-[#161B26] rounded-[24px] p-6 space-y-3.5 border border-[#262E3D] shadow-sm text-white">
          <div className="flex justify-between text-sm">
            <span className="text-[#94A3B8]">You sent</span>
            <span className="font-semibold text-white">{receipt.amountSent} {receipt.currencySent}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#94A3B8]">They received</span>
            <span className="font-extrabold text-white">{receipt.amountReceived} {receipt.currencyReceived}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#94A3B8]">Rate</span>
            <span className="text-white font-medium">1 {receipt.currencySent} = {receipt.effectiveRate} {receipt.currencyReceived}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#94A3B8]">Fee</span>
            <span className="font-semibold text-white">{receipt.fee}</span>
          </div>
          <div className="border-t border-[#262E3D] pt-3 mt-2">
            <a
              href={receipt.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-[#7C3AED] text-xs font-semibold hover:underline"
            >
              View on XRPL Explorer →
            </a>
          </div>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="w-full mt-6 py-4 rounded-2xl font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] text-white shadow-sm active:scale-[0.99] transition-all"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pt-6 pb-20 w-full max-w-md mx-auto min-h-screen bg-[#0D1017] text-white">
      {/* Top Header */}
      <header className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="w-10 h-10 rounded-full bg-[#161B26] border border-[#262E3D] flex items-center justify-center text-white shadow-sm hover:bg-[#1E2430] active:scale-95 transition-all"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xl font-bold tracking-tight text-white font-display">migo.</span>
        <div className="w-10"></div>
      </header>

      <h2 className="text-2xl font-bold tracking-tight text-white">Send Money</h2>
      <p className="text-xs text-[#94A3B8] mt-1 mb-6 font-medium">Instant cross-border settlement on XRPL.</p>

      <div className="space-y-4">
        <div>
          <label className="text-[11px] text-[#94A3B8] mb-1.5 block uppercase tracking-wider font-semibold">Recipient (@username or address)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]">
              <svg className="w-4 h-4 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </span>
            <input
              value={resolvedUser ? `@${resolvedUser.username}` : dest}
              onChange={(e) => { setDest(e.target.value); setResolvedUser(null); setRate(null); }}
              onBlur={resolveRecipient}
              onKeyDown={(e) => e.key === 'Enter' && resolveRecipient()}
              placeholder="@mac or rXXXXXXXXX..."
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm bg-[#161B26] border border-[#262E3D] text-white focus:outline-none focus:border-[#7C3AED] transition-colors font-medium"
            />
          </div>
          {lookingUp && <p className="text-xs text-[#94A3B8] mt-1.5 animate-pulse font-medium">Looking up user...</p>}
          {resolvedUser && (
            <p className="text-xs text-white font-semibold mt-1.5">
              ✓ {resolvedUser.displayName || resolvedUser.username} — <span className="font-mono text-[#94A3B8] font-normal">{resolvedUser.address.slice(0, 12)}...</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-[#94A3B8] mb-1.5 block uppercase tracking-wider font-semibold">You send</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setRate(null); }}
              placeholder="50.00"
              className="w-full px-4 py-3.5 rounded-2xl bg-[#161B26] border border-[#262E3D] text-white font-semibold text-sm focus:outline-none focus:border-[#7C3AED]"
            />
          </div>
          <div>
            <label className="text-[11px] text-[#94A3B8] mb-1.5 block uppercase tracking-wider font-semibold">Currency</label>
            <GlideSelect
              options={SEND_CURRENCIES}
              value={fromCurrency}
              onChange={(val) => { setFromCurrency(val); setRate(null); }}
              size="lg"
              menuWidth={180}
              surfaceColor="#161B26"
              highlightColor="#1E2430"
              accentColor="#7C3AED"
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] text-[#94A3B8] mb-1.5 block uppercase tracking-wider font-semibold">They receive in</label>
          <GlideSelect
            options={SEND_CURRENCIES}
            value={toCurrency}
            onChange={(val) => { setToCurrency(val); setRate(null); }}
            size="lg"
            menuWidth={180}
            surfaceColor="#161B26"
            highlightColor="#1E2430"
            accentColor="#7C3AED"
            className="w-full"
          />
        </div>

        {/* Rate preview */}
        {!rate && amount && dest && (
          <button
            onClick={checkRate}
            className="w-full py-3.5 rounded-2xl font-semibold text-xs uppercase tracking-wider text-white bg-[#1E2430] hover:bg-[#262E3D] border border-[#262E3D] transition-colors mt-2"
          >
            Check Rate
          </button>
        )}

        {rate && (
          <div className="bg-[#161B26] border border-[#262E3D] rounded-3xl p-5 space-y-2.5 mt-2 text-white">
            <div className="flex justify-between text-sm">
              <span className="text-[#94A3B8]">They receive (est.)</span>
              <span className="font-extrabold text-base text-white">~{parseFloat(rate.estimatedReceive).toFixed(2)} {toCurrency}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#94A3B8]">Rate</span>
              <span className="text-white font-medium">1 {fromCurrency} = {Number(rate.rate).toFixed(2)} {toCurrency}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#94A3B8]">Minimum received</span>
              <span className="font-semibold text-white">{parseFloat(rate.minReceived).toFixed(2)} {toCurrency}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#94A3B8]">Migo fee</span>
              <span className="font-semibold text-white">{rate.fee}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#94A3B8]">Network fee</span>
              <span className="text-[#94A3B8]">{rate.networkFee}</span>
            </div>
          </div>
        )}

        {error && <p className="text-red-400 text-xs font-semibold p-3.5 bg-red-950/40 border border-red-900/40 rounded-2xl">{error}</p>}

        <div className="pt-2 w-full flex justify-center">
          {rate ? (
            <SlideCommit
              label={`Slide to send ${amount} ${fromCurrency}`}
              doneLabel="Payment Delivered"
              errorLabel="Payment failed"
              onConfirm={handleSend}
              trackColor="#161B26"
              handleColor="#7C3AED"
              successColor="#7C3AED"
              dangerColor="#EF4444"
              width="100%"
              height={56}
              radius={24}
              className="w-full"
            />
          ) : (
            <SlideCommit
              label={!amount || !dest ? "Enter recipient & amount" : "Check rate to send"}
              disabled={true}
              trackColor="#161B26"
              handleColor="#1E2430"
              width="100%"
              height={56}
              radius={24}
              className="w-full opacity-60"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function Send() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[400px] text-[#94A3B8]">Loading...</div>}>
      <SendInner />
    </Suspense>
  );
}
