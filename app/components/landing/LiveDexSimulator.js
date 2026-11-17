// app/components/landing/LiveDexSimulator.js
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GlideSelect from '../reactbits/GlideSelect';

const RATES = {
  INR: { rate: 87.428, symbol: '₹', name: 'Indian Rupee' },
  EUR: { rate: 0.915, symbol: '€', name: 'Euro' },
  NGN: { rate: 1381.47, symbol: '₦', name: 'Nigerian Naira' },
};

const CURRENCY_OPTIONS = [
  { value: 'INR', label: 'INR (₹)', tag: 'India' },
  { value: 'EUR', label: 'EUR (€)', tag: 'Europe' },
  { value: 'NGN', label: 'NGN (₦)', tag: 'Nigeria' },
];

export default function LiveDexSimulator() {
  const router = useRouter();
  const [amount, setAmount] = useState('100');
  const [targetCur, setTargetCur] = useState('INR');

  const numAmt = Math.max(0, parseFloat(amount) || 0);
  const target = RATES[targetCur] || RATES.INR;
  const delivered = (numAmt * target.rate).toFixed(2);

  return (
    <div className="w-full max-w-xl mx-auto rounded-3xl bg-[#161B26] border border-[#262E3D] p-6 shadow-xl">
      <div className="flex items-center justify-between pb-4 border-b border-[#262E3D] mb-5">
        <span className="text-xs font-bold uppercase tracking-wider text-white">
          Transfer Rate Calculator
        </span>
        <span className="text-xs font-mono text-[#9CA3AF]">
          1 USD = {target.rate.toFixed(2)} {targetCur}
        </span>
      </div>

      {/* Input / Currency Cluster */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Send */}
        <div className="bg-[#0D1017] border border-[#262E3D] rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[#9CA3AF] mb-1">
            You Send (USD)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent text-xl font-bold text-white focus:outline-none"
              placeholder="100.00"
            />
          </div>
        </div>

        {/* Receive Currency Picker with GlideSelect */}
        <div className="bg-[#0D1017] border border-[#262E3D] rounded-2xl p-4 flex flex-col justify-between">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[#9CA3AF] mb-1">
            Recipient Gets
          </span>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xl font-bold text-white truncate">
              {target.symbol}{delivered}
            </span>
            <GlideSelect
              options={CURRENCY_OPTIONS}
              value={targetCur}
              onChange={(val) => setTargetCur(val)}
              size="md"
              menuWidth={140}
              surfaceColor="#1E2430"
              highlightColor="#262E3D"
              accentColor="#7C3AED"
              placement="bottom"
              align="right"
            />
          </div>
        </div>
      </div>

      {/* Breakdown Details */}
      <div className="bg-[#0D1017] border border-[#262E3D] rounded-2xl p-4 mb-5 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA3AF]">Exchange Rate</span>
          <span className="text-white font-medium">1 USD = {target.rate.toFixed(2)} {targetCur}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA3AF]">Transfer Fee</span>
          <span className="text-white font-bold">$0.00</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#9CA3AF]">Settlement Speed</span>
          <span className="text-white font-bold">Instant (3.2 seconds)</span>
        </div>
      </div>

      {/* Action CTA */}
      <button
        onClick={() => router.push('/login')}
        className="w-full py-4 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-bold text-sm tracking-wide active:scale-[0.99] transition-colors flex items-center justify-center gap-2"
      >
        <span>Send {amount ? `$${amount}` : 'Funds'} Now</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
      </button>
    </div>
  );
}
