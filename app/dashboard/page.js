// app/dashboard/page.js
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch, setUnlockToken } from '@/lib/client-api';
import { QRCodeSVG } from 'qrcode.react';
import CodeSlots from '../components/reactbits/CodeSlots';

const CURRENCY_SYMBOLS = { USD: '$', INR: '₹', EUR: '€', NGN: '₦', XRP: 'XRP ' };
const CURRENCY_NAMES = { USD: 'US Dollar', INR: 'Indian Rupee', EUR: 'Euro', NGN: 'Nigerian Naira', XRP: 'XRP Ledger' };

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

export default function Dashboard() {
  const { wallet, loading, logout } = useWallet();
  const router = useRouter();

  // Navigation View: 'wallet' (slide right / index 0) | 'home' (center / index 1) | 'history' (slide left / index 2)
  const [activeView, setActiveView] = useState('home');
  const [profileOpen, setProfileOpen] = useState(false);

  // Home card modes: 'home1' (privacy masked) | 'home2' (PIN entry) | 'home3' (revealed)
  const [homeMode, setHomeMode] = useState('home1');
  const [balance, setBalance] = useState('0.00');
  const [allBalances, setAllBalances] = useState({ USD: '0', INR: '0', EUR: '0', NGN: '0', XRP: '0' });
  const [transactions, setTransactions] = useState([]);
  const [copied, setCopied] = useState(false);

  // PIN Entry state (for HOME 2)
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const pinInputRef = useRef(null);

  // Touch gesture swipe state
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const fetchBalance = useCallback(async () => {
    if (!wallet) return;
    try {
      const data = await apiFetch('/api/wallet');
      if (data.success && data.balances) {
        setAllBalances(data.balances);
        const base = wallet.baseCurrency || 'USD';
        setBalance(data.balances[base] || '0');
      }
    } catch (error) {
      if (error?.status !== 401) console.error('Balance refresh failed');
    }
  }, [wallet]);

  const fetchTransactions = useCallback(async () => {
    if (!wallet) return;
    try {
      const data = await apiFetch('/api/history?limit=15');
      if (data.success && Array.isArray(data.transactions)) {
        setTransactions(data.transactions);
      }
    } catch {
      // Non-blocking
    }
  }, [wallet]);

  useEffect(() => {
    if (!loading && !wallet) { router.push('/'); return; }
    fetchBalance();
    fetchTransactions();

    const onFocus = () => {
      fetchBalance();
      fetchTransactions();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchBalance();
        fetchTransactions();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('migo:refresh-balance', onFocus);

    const interval = setInterval(fetchBalance, 10000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('migo:refresh-balance', onFocus);
      clearInterval(interval);
    };
  }, [loading, wallet, router, fetchBalance, fetchTransactions]);

  // Focus hidden input when switching to HOME 2
  useEffect(() => {
    if (homeMode === 'home2') {
      setPinInput('');
      setPinError('');
      setTimeout(() => pinInputRef.current?.focus(), 50);
    }
  }, [homeMode]);

  // Desktop keyboard listener for PIN entry
  useEffect(() => {
    if (homeMode !== 'home2') return;

    const onKeyDown = (e) => {
      if (verifyingPin) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setPinError('');
        const next = (pinInput + e.key).slice(0, 4);
        setPinInput(next);
        if (next.length === 4) verifyAndUnlock(next);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPinError('');
        setPinInput((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setHomeMode('home1');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [homeMode, pinInput, verifyingPin]);

  const copyAddress = () => {
    if (!wallet?.address) return;
    navigator.clipboard?.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCardClick = () => {
    if (homeMode === 'home1') {
      setHomeMode('home2');
    } else if (homeMode === 'home2') {
      pinInputRef.current?.focus();
    } else {
      setHomeMode('home1');
    }
  };

  const verifyAndUnlock = async (pinCode) => {
    setVerifyingPin(true);
    setPinError('');
    try {
      const res = await apiFetch('/api/onboarding/unlock', {
        method: 'POST',
        body: JSON.stringify({ pin: pinCode }),
      });
      if (res.success && res.unlockToken) {
        setUnlockToken(res.unlockToken);
        setHomeMode('home3');
        fetchBalance();
        fetchTransactions();
      } else {
        setPinError('Incorrect PIN');
        setPinInput('');
      }
    } catch (err) {
      setPinError(err.message || 'Incorrect PIN');
      setPinInput('');
    } finally {
      setVerifyingPin(false);
    }
  };

  // Touch Swipe Handlers for Gesture Navigation
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = touchStartX.current - e.changedTouches[0].clientX;
    const diffY = touchStartY.current - e.changedTouches[0].clientY;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 45) {
      if (diffX > 0) {
        if (activeView === 'wallet') setActiveView('home');
        else if (activeView === 'home') setActiveView('history');
      } else {
        if (activeView === 'history') setActiveView('home');
        else if (activeView === 'home') setActiveView('wallet');
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (loading || !wallet) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0D1017] text-[#94A3B8] text-sm">
        <div className="flex flex-col items-center gap-3">
          <img src="/ambassador.png" alt="Migo" className="w-12 h-12 rounded-full border border-[#262E3D]" />
          <span>Loading Migo...</span>
        </div>
      </div>
    );
  }

  const baseCur = wallet.baseCurrency || 'USD';
  const symbol = CURRENCY_SYMBOLS[baseCur] || '$';
  const formatted = formatAmount(balance);
  const truncatedAddress = wallet?.address
    ? `${wallet.address.slice(0, 8)}••••${wallet.address.slice(-6)}`
    : '';

  return (
    <div
      className="min-h-screen bg-[#0D1017] text-white flex flex-col justify-between select-none relative overflow-x-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* =========================================================================
          TOP NAVIGATION BAR (Persistent)
          ========================================================================= */}
      <header className="w-full max-w-md mx-auto pt-6 px-5 flex items-center justify-between z-30">
        {/* Left: Brand or Back */}
        <div className="flex items-center gap-2">
          {activeView === 'home' ? (
            <span className="text-xl font-bold tracking-tight text-white font-display">migo.</span>
          ) : (
            <button
              onClick={() => setActiveView('home')}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#94A3B8] hover:text-white transition-colors py-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back</span>
            </button>
          )}
        </div>

        {/* Center: Spatial Segment Indicator */}
        <div className="flex items-center gap-1 bg-[#161B26] border border-[#262E3D] rounded-full px-2 py-1">
          <button
            onClick={() => setActiveView('wallet')}
            className={`text-[10px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full transition-all ${
              activeView === 'wallet' ? 'bg-[#7C3AED] text-white' : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            Wallet
          </button>
          <button
            onClick={() => setActiveView('home')}
            className={`text-[10px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full transition-all ${
              activeView === 'home' ? 'bg-[#7C3AED] text-white' : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => setActiveView('history')}
            className={`text-[10px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full transition-all ${
              activeView === 'history' ? 'bg-[#7C3AED] text-white' : 'text-[#94A3B8] hover:text-white'
            }`}
          >
            History
          </button>
        </div>

        {/* Right: Ambassador Avatar Button -> Opens Profile Sheet */}
        <button
          onClick={() => setProfileOpen(true)}
          className="relative w-8 h-8 rounded-full border border-[#262E3D] bg-[#161B26] hover:border-[#7C3AED] active:scale-95 transition-all overflow-hidden flex items-center justify-center shrink-0"
          title="Profile & Settings"
        >
          <img
            src="/ambassador.png"
            alt="Ambassador"
            className="w-full h-full object-cover"
          />
        </button>
      </header>

      {/* =========================================================================
          MAIN SPATIAL CONTAINER (3 Views: Wallet Details | Home | History)
          ========================================================================= */}
      <main className="w-full max-w-md mx-auto px-5 py-4 flex-1 flex flex-col justify-start">
        
        {/* =====================================================================
            VIEW 0: WALLET DETAILS (Slide Right)
            ===================================================================== */}
        {activeView === 'wallet' && (
          <div className="animate-slide-up flex flex-col gap-4">
            <div className="bg-[#161B26] border border-[#262E3D] rounded-3xl p-5 flex flex-col items-center">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-[#94A3B8] mb-3">
                Receive Address
              </span>

              {/* Crisp Solid White QR Card - Zero Neon, High Contrast */}
              <div className="bg-white p-3 rounded-2xl shadow-sm mb-3">
                <QRCodeSVG
                  value={wallet.address || ''}
                  size={160}
                  level="M"
                  includeMargin={false}
                />
              </div>

              {/* Wallet Address Chip */}
              <div className="w-full bg-[#0D1017] border border-[#262E3D] rounded-2xl py-2 px-3 flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-[#94A3B8] truncate">
                  {wallet.address}
                </span>
                <button
                  onClick={copyAddress}
                  className="bg-[#1E2430] hover:bg-[#262E3D] text-white text-[11px] font-semibold px-2.5 py-1 rounded-xl active:scale-95 transition-all shrink-0"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Balances List across Supported Currencies */}
            <div className="bg-[#161B26] border border-[#262E3D] rounded-3xl p-4 flex flex-col gap-2.5">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-[#94A3B8] px-1">
                Your Ledger Balances
              </span>

              {Object.keys(CURRENCY_NAMES).map((cur) => {
                const bal = allBalances[cur] || '0';
                const curSym = CURRENCY_SYMBOLS[cur] || '';
                return (
                  <div
                    key={cur}
                    className="flex items-center justify-between p-3 rounded-2xl bg-[#0D1017] border border-[#262E3D]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[#1E2430] border border-[#262E3D] flex items-center justify-center font-bold text-xs text-white">
                        {cur}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white leading-tight">{CURRENCY_NAMES[cur]}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">
                        {cur === 'XRP' ? `${formatAmount(bal)} XRP` : `${curSym}${formatAmount(bal)}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =====================================================================
            VIEW 1: HOME DASHBOARD (Center Main)
            ===================================================================== */}
        {activeView === 'home' && (
          <div className="animate-slide-up flex flex-col gap-4">
            
            {/* Greeting */}
            <div className="px-1 pt-1">
              <p className="text-xs text-[#94A3B8] font-medium">Good day,</p>
              <h2 className="text-xl font-bold tracking-tight text-white">
                {wallet.displayName || wallet.username || 'Friend'}
              </h2>
            </div>

            {/* Solid Wallet Card (HOME 1 / HOME 2 / HOME 3) - Zero gradients */}
            <div
              onClick={handleCardClick}
              className="w-full rounded-[28px] p-5 bg-[#1E2430] border border-[#262E3D] shadow-sm flex flex-col justify-between min-h-[148px] cursor-pointer active:scale-[0.99] transition-all relative overflow-hidden"
            >
              {/* Card Header */}
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-semibold tracking-wider uppercase text-[#94A3B8] font-display">
                  {homeMode === 'home3' ? 'AVAILABLE BALANCE' : 'MIGO WALLET'}
                </span>

                {homeMode === 'home2' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPin(!showPin);
                    }}
                    className="text-[#94A3B8] hover:text-white p-0.5 text-xs font-semibold"
                  >
                    {showPin ? 'Hide' : 'Show'}
                  </button>
                ) : (
                  <span className="text-[10px] text-[#94A3B8] font-mono">
                    {homeMode === 'home3' ? truncatedAddress : 'Tap to reveal'}
                  </span>
                )}
              </div>

              {/* HOME 1: Privacy Blurred Mask */}
              {homeMode === 'home1' && (
                <div className="flex items-center justify-center gap-2.5 my-auto py-4">
                  <div className="h-2 w-8 rounded-full bg-white/20" />
                  <div className="h-2 w-8 rounded-full bg-white/20" />
                  <div className="h-2 w-8 rounded-full bg-white/20" />
                  <div className="h-2 w-8 rounded-full bg-white/20" />
                </div>
              )}

              {/* HOME 2: In-place PIN Entry via CodeSlots */}
              {homeMode === 'home2' && (
                <div className="flex flex-col items-center justify-center my-auto py-2">
                  <p className="text-[11px] text-[#94A3B8] mb-2 font-medium">Enter 4-digit device PIN</p>
                  <CodeSlots
                    length={4}
                    value={pinInput}
                    onChange={(val) => {
                      setPinInput(val);
                      setPinError('');
                    }}
                    onComplete={(code) => {
                      verifyAndUnlock(code);
                    }}
                    mask={!showPin}
                    status={verifyingPin ? 'idle' : pinError ? 'error' : 'idle'}
                    accentColor="#7C3AED"
                    inkColor="#7C3AED"
                    slotColor="#161B26"
                    digitColor="#FFFFFF"
                    dangerColor="#EF4444"
                    slotSize={42}
                    gap={8}
                    radius={12}
                    autoFocus={true}
                  />

                  {verifyingPin && (
                    <span className="text-[10px] text-[#94A3B8] animate-pulse mt-2 font-semibold">
                      Verifying PIN...
                    </span>
                  )}
                  {pinError && (
                    <span className="text-[10px] text-red-400 mt-2 font-bold">
                      {pinError}
                    </span>
                  )}
                </div>
              )}

              {/* HOME 3: Balance Display */}
              {homeMode === 'home3' && (
                <div className="flex flex-col items-center justify-center my-auto py-1">
                  <p className="text-3xl font-bold text-white tracking-tight leading-none mb-1">
                    {symbol}{formatted}
                  </p>
                  <span className="text-[11px] text-[#94A3B8] font-medium">
                    {baseCur}
                  </span>
                </div>
              )}

              {/* Card Footer */}
              <div className="flex items-center justify-between text-[10px] text-[#94A3B8]">
                <span>Migo Sovereign</span>
                <span className="font-mono text-white">{baseCur}</span>
              </div>
            </div>

            {/* Quick Actions Pod (3 Exact Buttons: SEND, SCAN, WALLET - NO Split Bill) */}
            <div className="grid grid-cols-3 gap-2 bg-[#161B26] border border-[#262E3D] rounded-2xl p-2.5">
              {/* SEND */}
              <button
                onClick={() => router.push('/send')}
                className="flex flex-col items-center justify-center py-2.5 rounded-xl hover:bg-[#1E2430] active:scale-95 transition-all group"
              >
                <div className="w-9 h-9 rounded-full bg-[#1E2430] border border-[#262E3D] flex items-center justify-center mb-1 text-white group-hover:border-[#7C3AED]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
                  </svg>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] group-hover:text-white">
                  Send
                </span>
              </button>

              {/* SCAN */}
              <button
                onClick={() => router.push('/scan')}
                className="flex flex-col items-center justify-center py-2.5 rounded-xl hover:bg-[#1E2430] active:scale-95 transition-all group"
              >
                <div className="w-9 h-9 rounded-full bg-[#1E2430] border border-[#262E3D] flex items-center justify-center mb-1 text-white group-hover:border-[#7C3AED]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2" />
                  </svg>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] group-hover:text-white">
                  Scan
                </span>
              </button>

              {/* WALLET (Slides to View 0) */}
              <button
                onClick={() => setActiveView('wallet')}
                className="flex flex-col items-center justify-center py-2.5 rounded-xl hover:bg-[#1E2430] active:scale-95 transition-all group"
              >
                <div className="w-9 h-9 rounded-full bg-[#1E2430] border border-[#262E3D] flex items-center justify-center mb-1 text-white group-hover:border-[#7C3AED]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] group-hover:text-white">
                  Wallet
                </span>
              </button>
            </div>

            {/* Recent Activity Section */}
            <div className="bg-[#161B26] border border-[#262E3D] rounded-3xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between px-1 mb-1">
                <span className="text-[11px] font-semibold tracking-wider uppercase text-[#94A3B8]">
                  Recent Activity
                </span>
                <button
                  onClick={() => setActiveView('history')}
                  className="text-[11px] font-semibold text-[#94A3B8] hover:text-white flex items-center gap-1 transition-colors"
                >
                  View All →
                </button>
              </div>

              {transactions.length === 0 ? (
                <div className="text-center py-6 text-[#94A3B8] text-xs">
                  No transactions recorded yet
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {transactions.slice(0, 3).map((tx, idx) => {
                    const isOut = tx.direction === 'out';
                    const sign = isOut ? '-' : '+';
                    const txSymbol = CURRENCY_SYMBOLS[tx.currencyReceived || tx.currencySent] || '$';
                    const displayAmt = isOut ? tx.amountSent : tx.amountReceived;

                    return (
                      <div
                        key={tx.txHash || idx}
                        className="flex items-center justify-between p-3 rounded-2xl bg-[#0D1017] border border-[#262E3D]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                            isOut ? 'bg-[#1E2430] text-[#94A3B8]' : 'bg-[#1E2430] text-[#7C3AED]'
                          }`}>
                            {isOut ? '↗' : '↙'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate leading-tight">
                              {tx.label || (isOut ? 'Payment Sent' : 'Payment Received')}
                            </p>
                            <p className="text-[10px] text-[#94A3B8] font-medium leading-tight mt-0.5">
                              {formatDate(tx.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-white">
                            {sign}{txSymbol}{formatAmount(displayAmt)}
                          </p>
                          <span className="text-[9px] uppercase tracking-wider text-[#94A3B8] font-semibold block">
                            {tx.currencyReceived || tx.currencySent}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* =====================================================================
            VIEW 2: TRANSACTION HISTORY (Slide Left)
            ===================================================================== */}
        {activeView === 'history' && (
          <div className="animate-slide-up flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-bold text-white">Full Transaction History</h2>
              <span className="text-[10px] text-[#94A3B8] font-semibold bg-[#161B26] border border-[#262E3D] px-2 py-0.5 rounded-full">
                {transactions.length} items
              </span>
            </div>

            {transactions.length === 0 ? (
              <div className="bg-[#161B26] border border-[#262E3D] rounded-3xl p-8 text-center text-[#94A3B8] text-xs">
                No ledger transactions found.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {transactions.map((tx, idx) => {
                  const isOut = tx.direction === 'out';
                  const sign = isOut ? '-' : '+';
                  const txSymbol = CURRENCY_SYMBOLS[tx.currencyReceived || tx.currencySent] || '$';
                  const displayAmt = isOut ? tx.amountSent : tx.amountReceived;

                  return (
                    <div
                      key={tx.txHash || idx}
                      className="p-3.5 rounded-2xl bg-[#161B26] border border-[#262E3D] flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                            isOut ? 'bg-[#1E2430] text-[#94A3B8]' : 'bg-[#1E2430] text-[#7C3AED]'
                          }`}>
                            {isOut ? '↗' : '↙'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate leading-tight">
                              {tx.label || (isOut ? 'Payment Sent' : 'Payment Received')}
                            </p>
                            <p className="text-[10px] text-[#94A3B8] font-medium leading-tight mt-0.5">
                              {formatDate(tx.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold text-white">
                            {sign}{txSymbol}{formatAmount(displayAmt)}
                          </p>
                          <span className="text-[9px] uppercase tracking-wider text-[#94A3B8] font-semibold block">
                            {tx.currencyReceived || tx.currencySent}
                          </span>
                        </div>
                      </div>

                      {tx.explorerUrl && (
                        <div className="pt-2 border-t border-[#262E3D] flex justify-between items-center text-[10px]">
                          <span className="text-[#94A3B8] font-mono">
                            {tx.txHash ? `${tx.txHash.slice(0, 12)}...` : 'XRPL Testnet'}
                          </span>
                          <a
                            href={tx.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#7C3AED] hover:underline font-semibold"
                          >
                            View on Ledger →
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>

      {/* =========================================================================
          PROFILE DETAILS DRAWER (Modal sheet)
          ========================================================================= */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end animate-fade-in-out">
          <div className="w-full max-w-xs bg-[#161B26] border-l border-[#262E3D] h-full p-6 flex flex-col justify-between overflow-y-auto">
            {/* Drawer Top */}
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#262E3D]">
                <span className="text-xs font-semibold tracking-wider uppercase text-[#94A3B8]">
                  Profile Details
                </span>
                <button
                  onClick={() => setProfileOpen(false)}
                  className="w-7 h-7 rounded-full bg-[#1E2430] text-[#94A3B8] hover:text-white flex items-center justify-center font-bold text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Ambassador Avatar & Identity */}
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-20 h-20 rounded-2xl border-2 border-[#7C3AED] bg-[#0D1017] overflow-hidden shadow-sm">
                  <img
                    src="/ambassador.png"
                    alt="Migo Ambassador"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {wallet.displayName || 'Mac Kenzie'}
                  </h3>
                  <p className="text-xs text-[#7C3AED] font-semibold">
                    @{wallet.username || 'mac'}
                  </p>
                  <span className="inline-block mt-1 text-[9px] uppercase tracking-wider bg-[#1E2430] text-[#94A3B8] px-2 py-0.5 rounded-full border border-[#262E3D]">
                    Migo Ambassador
                  </span>
                </div>
              </div>

              {/* Account Meta List */}
              <div className="flex flex-col gap-2.5 bg-[#0D1017] border border-[#262E3D] rounded-2xl p-3.5 text-xs">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] block">Verified Email</span>
                  <span className="font-semibold text-white truncate block">
                    {wallet.email || 'mackenzieandross@gmail.com'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] block">Base Currency</span>
                  <span className="font-semibold text-white block">
                    {wallet.baseCurrency || 'USD'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] block">Device Security</span>
                  <span className="font-semibold text-white">
                    PIN Protection Active
                  </span>
                </div>
              </div>
            </div>

            {/* Drawer Bottom Actions */}
            <div className="pt-6 border-t border-[#262E3D]">
              <button
                onClick={logout}
                className="w-full py-3 bg-[#1E2430] hover:bg-red-950/40 text-red-400 border border-red-900/40 rounded-2xl text-xs font-semibold tracking-wider uppercase transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
