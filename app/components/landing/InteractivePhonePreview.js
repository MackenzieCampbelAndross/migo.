// app/components/landing/InteractivePhonePreview.js
'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function InteractivePhonePreview() {
  const [tab, setTab] = useState('home');

  return (
    <div className="relative mx-auto w-full max-w-[340px] select-none">
      {/* iPhone Frame */}
      <div className="rounded-[44px] bg-[#0D1017] border-4 border-[#262E3D] p-3 shadow-2xl overflow-hidden relative">
        {/* Dynamic Island */}
        <div className="w-24 h-4 bg-black rounded-full mx-auto mb-3 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-[#161B26]" />
        </div>

        {/* Screen Header */}
        <div className="flex items-center justify-between px-2 mb-3">
          <span className="text-xs font-bold font-display tracking-tight text-white">migo.</span>
          <div className="flex items-center gap-1 bg-[#161B26] border border-[#262E3D] rounded-full p-0.5">
            <button
              onClick={() => setTab('wallet')}
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all ${
                tab === 'wallet' ? 'bg-[#7C3AED] text-white' : 'text-[#94A3B8]'
              }`}
            >
              Wallet
            </button>
            <button
              onClick={() => setTab('home')}
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all ${
                tab === 'home' ? 'bg-[#7C3AED] text-white' : 'text-[#94A3B8]'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => setTab('history')}
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all ${
                tab === 'history' ? 'bg-[#7C3AED] text-white' : 'text-[#94A3B8]'
              }`}
            >
              Activity
            </button>
          </div>
          <div className="w-6 h-6 rounded-full border border-[#262E3D] overflow-hidden bg-[#161B26]">
            <img src="/ambassador.png" alt="Ambassador" className="w-full h-full object-cover" />
          </div>
        </div>

        {/* ==================== SCREEN 0: WALLET ==================== */}
        {tab === 'wallet' && (
          <div className="flex flex-col gap-2.5 animate-slide-up pb-2">
            <div className="bg-[#161B26] border border-[#262E3D] rounded-2xl p-3 flex flex-col items-center">
              <span className="text-[9px] uppercase tracking-wider font-bold text-[#94A3B8] mb-2">
                Receive Address
              </span>
              <div className="bg-white p-2 rounded-xl mb-2">
                <QRCodeSVG value="rGsKfhmgpFnrSijpAbLGe2BRkEsDbNzg5x" size={110} />
              </div>
              <span className="text-[9px] font-mono text-[#94A3B8] bg-[#0D1017] px-2 py-1 rounded-lg border border-[#262E3D]">
                rGsKfhm...DbNzg5x
              </span>
            </div>

            <div className="bg-[#161B26] border border-[#262E3D] rounded-2xl p-2.5 space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-white font-medium">USD Balance</span>
                <span className="text-white font-bold">$500.00</span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-white font-medium">INR Balance</span>
                <span className="text-white font-bold">₹25,000.00</span>
              </div>
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-white font-medium">XRP Gas Balance</span>
                <span className="text-white font-bold">99.99 XRP</span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== SCREEN 1: HOME ==================== */}
        {tab === 'home' && (
          <div className="flex flex-col gap-2.5 animate-slide-up pb-2">
            {/* Card - Solid dark charcoal, no gradient */}
            <div className="rounded-2xl p-3.5 bg-[#1E2430] border border-[#262E3D]">
              <div className="flex justify-between items-center text-[9px] text-[#94A3B8] uppercase tracking-wider mb-2">
                <span>Available Balance</span>
                <span className="text-white font-mono">USD</span>
              </div>
              <p className="text-2xl font-bold text-white tracking-tight leading-none mb-1">
                $500.00
              </p>
              <span className="text-[9px] text-[#94A3B8] font-mono">rGsKfhm...Nzg5x</span>
            </div>

            {/* Quick Actions (SEND, SCAN, WALLET) */}
            <div className="grid grid-cols-3 gap-1.5 bg-[#161B26] border border-[#262E3D] rounded-xl p-1.5 text-center">
              <div className="p-1.5 rounded-lg bg-[#1E2430] text-[9px] font-bold text-white hover:bg-[#262E3D]">
                ↗ Send
              </div>
              <div className="p-1.5 rounded-lg bg-[#1E2430] text-[9px] font-bold text-white hover:bg-[#262E3D]">
                ⚏ Scan
              </div>
              <div className="p-1.5 rounded-lg bg-[#1E2430] text-[9px] font-bold text-white hover:bg-[#262E3D]">
                💳 Wallet
              </div>
            </div>

            {/* Recent rows */}
            <div className="bg-[#161B26] border border-[#262E3D] rounded-2xl p-2.5 space-y-1.5">
              <span className="text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider block">
                Latest Activity
              </span>
              <div className="flex justify-between items-center text-[10px] bg-[#0D1017] p-2 rounded-lg border border-[#262E3D]">
                <span className="text-white truncate">Sent to @ragul</span>
                <span className="text-white font-bold">-$0.05</span>
              </div>
              <div className="flex justify-between items-center text-[10px] bg-[#0D1017] p-2 rounded-lg border border-[#262E3D]">
                <span className="text-white truncate">Cross-border USD→INR</span>
                <span className="text-white font-bold">+₹4.37</span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== SCREEN 2: HISTORY ==================== */}
        {tab === 'history' && (
          <div className="flex flex-col gap-2 animate-slide-up pb-2">
            <span className="text-[10px] font-bold text-white px-1">Ledger Stream</span>
            <div className="bg-[#161B26] border border-[#262E3D] rounded-2xl p-2 space-y-1.5">
              <div className="flex justify-between items-center text-[10px] p-2 border-b border-[#262E3D]">
                <div>
                  <p className="text-white font-bold leading-tight">Payment Out</p>
                  <p className="text-[8px] text-[#94A3B8]">Just now</p>
                </div>
                <p className="text-white font-bold">-$0.05 USD</p>
              </div>
              <div className="flex justify-between items-center text-[10px] p-2 border-b border-[#262E3D]">
                <div>
                  <p className="text-white font-bold leading-tight">DEX Swap In</p>
                  <p className="text-[8px] text-[#94A3B8]">10m ago</p>
                </div>
                <p className="text-white font-bold">+₹4.37 INR</p>
              </div>
              <div className="flex justify-between items-center text-[10px] p-2">
                <div>
                  <p className="text-white font-bold leading-tight">Faucet Top-Up</p>
                  <p className="text-[8px] text-[#94A3B8]">Nov 14</p>
                </div>
                <p className="text-white font-bold">+100.00 XRP</p>
              </div>
            </div>
          </div>
        )}

        {/* Bottom home indicator */}
        <div className="w-20 h-1 bg-white/20 rounded-full mx-auto mt-2" />
      </div>
    </div>
  );
}
