// app/history/page.js
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import dynamic from 'next/dynamic';

const TransferGlobe = dynamic(() => import('../components/TransferGlobe'), { ssr: false });

export default function History() {
  const { wallet } = useWallet();
  const router = useRouter();
  const [transactions, setTransactions] = useState([]);
  const [expanded, setExpanded] = useState(null); // tx hash of expanded item
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wallet) { router.push('/'); return; }
    fetchHistory();
  }, [wallet, router]);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/history?address=${wallet.address}`);
      const data = await res.json();
      if (data.success) setTransactions(data.transactions);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  if (!wallet) return null;

  return (
    <div className="px-4 pt-6 pb-28">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xl font-extrabold text-[#1C1C1E] tracking-tight">Migo.</span>
        <button
          onClick={() => router.push('/dashboard')}
          title="Notifications"
          className="w-10 h-10 rounded-full bg-[#FFFFFF] border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] shadow-sm hover:bg-[#F2F2F7] active:scale-95 transition-all"
        >
          <svg className="w-4 h-4 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 01-6 0v-1m6 0H9" />
          </svg>
        </button>
      </div>

      <h2 className="text-3xl font-extrabold text-[#1C1C1E] tracking-tight mb-6">Transaction History</h2>

      {loading && <p className="text-center text-[#8E8E93] py-12 font-medium animate-pulse">Loading transactions...</p>}

      {!loading && transactions.length === 0 && (
        <div className="card rounded-3xl p-8 text-center bg-[#F2F2F7] border border-[#E5E5EA] py-12">
          <p className="text-[#8E8E93] font-medium mb-3">No transactions yet</p>
          <button
            onClick={() => router.push('/send')}
            className="px-5 py-2.5 bg-[#000000] text-white text-xs font-semibold rounded-full shadow-sm"
          >
            Send your first payment →
          </button>
        </div>
      )}

      <div className="space-y-3">
        {transactions.map((tx) => {
          const isSender = tx.sender === wallet.address;
          const isExpanded = expanded === tx.txHash;

          const isEscrow = tx.type === 'EscrowCreate' || tx.type === 'EscrowFinish';
          let label, icon;
          if (tx.type === 'EscrowCreate') {
            label = isSender ? 'Split Locked' : 'Split Pending';
            icon = '⚏';
          } else if (tx.type === 'EscrowFinish') {
            label = isSender ? 'Split Released' : 'Split Claimed';
            icon = isSender ? '↗' : '↙';
          } else {
            label = isSender ? 'Sent' : 'Received';
            icon = isSender ? '↗' : '↙';
          }
          const displayAmount = isEscrow
            ? tx.amountReceived
            : (isSender ? tx.amountSent : tx.amountReceived);
          const displayCurrency = isEscrow
            ? tx.currencyReceived
            : (isSender ? tx.currencySent : tx.currencyReceived);
          const sign = (tx.type === 'EscrowCreate' && isSender) ? '-'
            : (tx.type === 'EscrowFinish' && isSender) ? '-'
            : (isSender && !isEscrow) ? '-' : '+';

          return (
            <div
              key={tx.txHash}
              className="card rounded-3xl overflow-hidden bg-[#F2F2F7] border border-[#E5E5EA] transition-all"
            >
              {/* Summary row (Matching Reference Image 4) */}
              <button
                onClick={() => setExpanded(isExpanded ? null : tx.txHash)}
                className="w-full p-4 text-left focus:outline-none"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-full bg-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] font-semibold text-lg shrink-0">
                      {icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#1C1C1E]">
                        {label} {displayCurrency}
                      </p>
                      <p className="text-xs text-[#8E8E93] font-medium mt-0.5">
                        {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-sm text-[#1C1C1E] tracking-tight">
                      {sign}{parseFloat(displayAmount).toFixed(2)} {displayCurrency}
                    </p>
                  </div>
                </div>
              </button>

              {/* Expanded details with globe */}
              {isExpanded && (
                <div className="animate-slide-up border-t border-[#E5E5EA]">
                  {/* Globe animation for cross-currency transfers */}
                  {tx.currencySent && tx.currencyReceived && tx.currencySent !== tx.currencyReceived && (
                    <div className="h-44 w-full bg-[#F8F8FA]">
                      <TransferGlobe
                        fromCurrency={tx.currencySent}
                        toCurrency={tx.currencyReceived}
                      />
                    </div>
                  )}
                  <div className="px-5 pb-5 pt-4 space-y-2 bg-[#F2F2F7]">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8E8E93]">Amount sent</span>
                      <span className="font-semibold text-[#1C1C1E]">{parseFloat(tx.amountSent).toFixed(2)} {tx.currencySent}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8E8E93]">Amount received</span>
                      <span className="font-bold text-[#1C1C1E]">{parseFloat(tx.amountReceived).toFixed(2)} {tx.currencyReceived}</span>
                    </div>
                    {tx.currencySent !== tx.currencyReceived && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[#8E8E93]">Exchange rate</span>
                        <span className="text-[#1C1C1E] font-medium">1 {tx.currencySent} = {tx.effectiveRate} {tx.currencyReceived}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8E8E93]">Fee</span>
                      <span className="font-semibold text-[#1C1C1E]">{tx.fee || '$0.00'}</span>
                    </div>
                    <a
                      href={tx.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-[#1C1C1E] text-xs font-semibold pt-2 underline"
                    >
                      View on XRPL Explorer →
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
