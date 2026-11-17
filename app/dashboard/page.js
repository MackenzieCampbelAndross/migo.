// app/dashboard/page.js
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { QRCodeSVG } from 'qrcode.react';

const CURRENCY_SYMBOLS = { USD: '$', INR: '₹', EUR: '€', NGN: '₦', XRP: '' };
const CURRENCY_NAMES = { USD: 'US Dollar', INR: 'Indian Rupee', EUR: 'Euro', NGN: 'Nigerian Naira', XRP: 'XRP' };

export default function Dashboard() {
  const { wallet, loading, logout } = useWallet();
  const router = useRouter();
  const [balance, setBalance] = useState(null);
  const [baseCurrency, setBaseCurrency] = useState(wallet?.baseCurrency || null);
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  // Determine base currency from wallet context or fetch from API
  useEffect(() => {
    if (!wallet) return;
    if (wallet.baseCurrency) {
      setBaseCurrency(wallet.baseCurrency);
    } else {
      // Fallback: fetch from user API
      fetch(`/api/user?address=${wallet.address}`)
        .then(r => r.json())
        .then(d => { if (d.success) setBaseCurrency(d.user.baseCurrency || 'USD'); })
        .catch(() => setBaseCurrency('USD'));
    }
  }, [wallet]);

  const fetchBalance = useCallback(async () => {
    if (!wallet) return;
    const cur = baseCurrency || wallet.baseCurrency;
    if (!cur) return;
    try {
      const res = await fetch(`/api/wallet?address=${wallet.address}&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && data.balances) {
        setBalance(data.balances[cur] || '0');
      }
    } catch (e) { console.error(e); }
  }, [wallet, baseCurrency]);

  useEffect(() => {
    if (!loading && !wallet) { router.push('/'); return; }
    fetchBalance();

    const onFocus = () => fetchBalance();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchBalance();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('migo:refresh-balance', onFocus);

    const interval = setInterval(fetchBalance, 4000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('migo:refresh-balance', onFocus);
      clearInterval(interval);
    };
  }, [loading, wallet, router, fetchBalance]);

  const copyAddress = () => {
    navigator.clipboard?.writeText(wallet?.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || !wallet) return <div className="flex items-center justify-center h-full min-h-[400px] text-[#8E8E93] text-sm font-light">Loading...</div>;

  const cur = baseCurrency || 'USD';
  const symbol = CURRENCY_SYMBOLS[cur] || '';
  const name = CURRENCY_NAMES[cur] || cur;
  const formatted = balance !== null
    ? parseFloat(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

  return (
    <div className="px-5 pt-6 pb-6 w-full max-w-2xl mx-auto">

      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#1C1C1E]">
          Migo.
        </h1>
        <button
          onClick={logout}
          title="Sign Out"
          className="w-9 h-9 rounded-full bg-[#F2F2F7] border border-[#E5E5EA]/80 flex items-center justify-center text-[#8E8E93] hover:text-[#1C1C1E] hover:bg-[#E5E5EA] active:scale-95 transition-all"
        >
          <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </header>

      {/* Balance Card */}
      <div className="bg-[#000000] rounded-[28px] px-7 pt-8 pb-7 mb-4 text-center shadow-[0_2px_16px_-4px_rgba(0,0,0,0.25)]">
        <div className="inline-flex items-center justify-center px-3.5 py-1 rounded-full bg-[#1A1A1A] border border-[#2A2A2E]/60 mb-5">
          <span className="text-[10px] font-medium tracking-[0.12em] text-[#9A9A9E] uppercase">
            {cur} · {name}
          </span>
        </div>

        {balance !== null ? (
          <p className="text-[44px] font-extralight text-white tracking-tight leading-none mb-6">
            {symbol}{formatted}
          </p>
        ) : (
          <p className="text-[36px] text-[#555] font-extralight mb-6 animate-pulse">—</p>
        )}

        <p className="text-[9px] text-[#666] font-medium uppercase tracking-[0.2em]">
          Available Balance
        </p>
      </div>

      {/* Wallet Identity */}
      <div className="bg-[#FFFFFF] border border-[#E8E8ED] rounded-[20px] px-5 py-4 mb-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 pr-3">
            {wallet.username && (
              <p className="text-[15px] font-semibold text-[#1C1C1E] truncate leading-snug">@{wallet.username}</p>
            )}
            <p className="text-[11px] text-[#A1A1A6] font-mono truncate mt-1 leading-snug">{wallet.address}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={copyAddress}
              className="h-8 px-3.5 bg-[#F2F2F7] hover:bg-[#E8E8ED] border border-[#E5E5EA]/80 text-[#3A3A3C] rounded-full text-[11px] font-semibold transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setShowQR(!showQR)}
              className="w-8 h-8 bg-[#F2F2F7] hover:bg-[#E8E8ED] border border-[#E5E5EA]/80 text-[#3A3A3C] rounded-full flex items-center justify-center transition-colors"
              title="Show QR Code"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <path strokeLinecap="round" d="M14 14h2v2h-2zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
              </svg>
            </button>
          </div>
        </div>

        {showQR && (
          <div className="flex justify-center mt-4 p-5 bg-[#FAFAFA] rounded-2xl border border-[#E8E8ED]">
            <QRCodeSVG value={wallet.address} size={180} level="M" className="w-full max-w-[180px] h-auto" />
          </div>
        )}
      </div>

      {/* Split Bill */}
      <button
        onClick={() => router.push('/split')}
        className="w-full h-12 bg-[#1C1C1E] hover:bg-[#2C2C2E] text-white rounded-2xl text-[13px] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.12)] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
      >
        <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 0A3 3 0 104.5 13.5A3 3 0 009.121 9.121zm0 0l2.879 2.879M4.5 4.5a3 3 0 114.621 4.621" />
        </svg>
        Split Bill
      </button>
    </div>
  );
}
