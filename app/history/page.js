'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch } from '@/lib/client-api';
import dynamic from 'next/dynamic';

const TransferGlobe = dynamic(() => import('../components/TransferGlobe'), { ssr: false });

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

export default function History() {
  const { wallet, loading } = useWallet();
  const router = useRouter();
  const [transactions, setTransactions] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [requestLoading, setRequestLoading] = useState(true);
  const [error, setError] = useState('');
  const [refundingId, setRefundingId] = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!wallet) return;
    setRequestLoading(true);
    setError('');

    try {
      const data = await apiFetch('/api/history');
      if (data.success) setTransactions(data.transactions || []);
    } catch (err) {
      setError(err.message || 'Unable to load transactions');
    }

    setRequestLoading(false);
  }, [wallet]);

  useEffect(() => {
    if (!loading && !wallet) {
      router.push('/');
      return;
    }
    if (wallet) fetchHistory();
  }, [loading, wallet, router, fetchHistory]);

  const refund = async (escrowId) => {
    if (!escrowId || refundingId) return;
    setRefundingId(escrowId);
    setError('');

    try {
      await apiFetch('/api/escrow/refund', {
        method: 'POST',
        body: JSON.stringify({ escrowId }),
      });
      await fetchHistory();
    } catch (err) {
      setError(err.message || 'Refund failed');
    }

    setRefundingId(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full min-h-[400px] text-[#8E8E93] text-sm">Loading...</div>;
  }

  if (!wallet) return null;

  return (
    <div className="px-4 pt-6 pb-28">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xl font-extrabold text-[#1C1C1E] tracking-tight">Migo.</span>
        <button
          onClick={() => router.push('/dashboard')}
          title="Home"
          className="w-10 h-10 rounded-full bg-[#FFFFFF] border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] shadow-sm hover:bg-[#F2F2F7] active:scale-95 transition-all"
        >
          <svg className="w-4 h-4 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>
      </div>

      <h2 className="text-3xl font-extrabold text-[#1C1C1E] tracking-tight mb-6">Transaction History</h2>

      {requestLoading && <p className="text-center text-[#8E8E93] py-12 font-medium animate-pulse">Loading transactions...</p>}

      {error && (
        <p className="text-[#1C1C1E] text-xs font-semibold p-3.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl mb-4">
          {error}
        </p>
      )}

      {!requestLoading && !error && transactions.length === 0 && (
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
          const isExpanded = expanded === tx.txHash;
          const isEscrow = Boolean(tx.isEscrow);
          const isOutgoing = tx.direction === 'out';
          const label = tx.label || (isOutgoing ? 'Sent' : 'Received');
          const displayAmount = isEscrow
            ? tx.amountReceived
            : (isOutgoing ? tx.amountSent : tx.amountReceived);
          const displayCurrency = isEscrow
            ? tx.currencyReceived
            : (isOutgoing ? tx.currencySent : tx.currencyReceived);
          const sign = isOutgoing ? '-' : '+';
          const icon = isEscrow ? '⚏' : (isOutgoing ? '↗' : '↙');

          return (
            <div key={tx.txHash} className="card rounded-3xl overflow-hidden bg-[#F2F2F7] border border-[#E5E5EA] transition-all">
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
                        {label} {isEscrow ? displayCurrency : ''}
                      </p>
                      <p className="text-xs text-[#8E8E93] font-medium mt-0.5">
                        {formatDate(tx.createdAt)}
                        {isEscrow && tx.escrowStatus ? ` · ${tx.escrowStatus}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-sm text-[#1C1C1E] tracking-tight">
                      {sign}{formatAmount(displayAmount)} {displayCurrency}
                    </p>
                    {tx.isSplit && (
                      <span className="text-[10px] text-[#8E8E93] font-semibold uppercase tracking-wider">Split</span>
                    )}
                  </div>
                </div>
              </button>

              {tx.canRefund && (
                <div className="px-4 pb-4">
                  <button
                    onClick={() => refund(tx.escrowId)}
                    disabled={refundingId === tx.escrowId}
                    className="w-full py-3 rounded-2xl text-xs font-semibold bg-[#000000] text-white disabled:opacity-40"
                  >
                    {refundingId === tx.escrowId ? 'Refunding...' : 'Refund expired escrow'}
                  </button>
                </div>
              )}

              {isExpanded && (
                <div className="animate-slide-up border-t border-[#E5E5EA]">
                  {tx.currencySent && tx.currencyReceived && tx.currencySent !== tx.currencyReceived && (
                    <div className="h-44 w-full bg-[#F8F8FA]">
                      <TransferGlobe fromCurrency={tx.currencySent} toCurrency={tx.currencyReceived} />
                    </div>
                  )}
                  <div className="px-5 pb-5 pt-4 space-y-2 bg-[#F2F2F7]">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8E8E93]">Amount sent</span>
                      <span className="font-semibold text-[#1C1C1E]">{formatAmount(tx.amountSent)} {tx.currencySent}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8E8E93]">Amount received</span>
                      <span className="font-bold text-[#1C1C1E]">{formatAmount(tx.amountReceived)} {tx.currencyReceived}</span>
                    </div>
                    {tx.currencySent !== tx.currencyReceived && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[#8E8E93]">Exchange rate</span>
                        <span className="text-[#1C1C1E] font-medium">1 {tx.currencySent} = {tx.effectiveRate} {tx.currencyReceived}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-[#8E8E93]">Fee</span>
                      <span className="font-semibold text-[#1C1C1E]">{tx.fee || '—'}</span>
                    </div>
                    {isEscrow && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[#8E8E93]">Escrow status</span>
                        <span className="font-semibold text-[#1C1C1E]">{tx.escrowStatus || '—'}</span>
                      </div>
                    )}
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
