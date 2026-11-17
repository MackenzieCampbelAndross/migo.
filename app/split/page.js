// app/split/page.js
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch, newIdempotencyKey } from '@/lib/client-api';

export default function Split() {
  const { wallet, loading } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !wallet) router.push('/');
  }, [loading, wallet, router]);

  const [totalAmount, setTotalAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [recipients, setRecipients] = useState([{ username: '', amount: '', resolved: null, error: '' }]);
  const [splitMode, setSplitMode] = useState('equal'); // 'equal' | 'custom'
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [lookingUp, setLookingUp] = useState({});
  const splitKeyRef = useRef(newIdempotencyKey());

  useEffect(() => {
    splitKeyRef.current = newIdempotencyKey();
  }, [totalAmount, currency, splitMode, recipients]);

  // Lookup a username
  const lookupUser = async (index) => {
    const username = recipients[index].username.trim().replace(/^@/, '');
    if (!username || username.length < 3) return;

    setLookingUp((prev) => ({ ...prev, [index]: true }));
    try {
      const data = await apiFetch(`/api/user?username=${encodeURIComponent(username)}`);
      const updated = [...recipients];
      if (data.success) {
        updated[index].resolved = data.user;
        updated[index].error = '';
        updated[index].username = data.user.username;
      }
      setRecipients(updated);
    } catch (err) {
      const updated = [...recipients];
      updated[index].resolved = null;
      updated[index].error = err.message || 'User not found';
      setRecipients(updated);
    }
    setLookingUp((prev) => ({ ...prev, [index]: false }));
  };

  const addRecipient = () => {
    if (recipients.length >= 10) return;
    setRecipients([...recipients, { username: '', amount: '', resolved: null, error: '' }]);
  };

  const removeRecipient = (index) => {
    if (recipients.length <= 1) return;
    setRecipients(recipients.filter((_, i) => i !== index));
  };

  const updateRecipient = (index, field, value) => {
    const updated = [...recipients];
    updated[index][field] = value;
    if (field === 'username') {
      updated[index].resolved = null;
      updated[index].error = '';
    }
    setRecipients(updated);
  };

  // Auto-calculate equal splits
  const equalAmount = totalAmount && recipients.length > 0
    ? (parseFloat(totalAmount) / recipients.length).toFixed(2)
    : '';

  const computedTotal = splitMode === 'equal'
    ? totalAmount
    : recipients.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0).toFixed(2);

  const allResolved = recipients.every((r) => r.resolved);
  const canSend = allResolved && parseFloat(computedTotal) > 0 && !sending;

  const handleSplit = async () => {
    setSending(true);
    setError('');
    try {
      const splits = recipients.map((r) => ({
        to: r.username,
        amount: splitMode === 'equal' ? equalAmount : r.amount,
      }));

      const data = await apiFetch('/api/split', {
        method: 'POST',
        body: JSON.stringify({
          currency,
          idempotencyKey: splitKeyRef.current || newIdempotencyKey(),
          splits,
        }),
      });

      if (data.success) {
        setResult(data);
        splitKeyRef.current = newIdempotencyKey();
      }
    } catch (err) {
      setError(err.message || 'Split payment failed');
    }
    setSending(false);
  };

  if (!wallet) return <div className="flex items-center justify-center h-screen text-[#8E8E93]">Loading...</div>;

  // Result screen
  if (result) {
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
            <svg className="w-6 h-6 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1E]">Split Created!</h2>
          <p className="text-sm text-[#8E8E93] mt-1">
            {result.splitCount} escrows created · {result.totalAmount} {result.currency || 'USD'} total
          </p>
        </div>

        <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl p-4 mb-4">
          <p className="text-xs text-[#8E8E93] text-center">
            {result.codesUnavailable
              ? 'This split was already created. Claim codes are shown only once; unclaimed splits can be refunded from history after expiry.'
              : 'Share each code with its recipient. They can also see the split in Requests → Claims and claim it with the code.'}
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {result.splits.map((s, i) => (
            <div key={i} className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-3xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-bold text-[#1C1C1E]">{s.username ? `@${s.username}` : 'Recipient'}</span>
                  {s.displayName && <span className="text-xs text-[#8E8E93] ml-2">{s.displayName}</span>}
                </div>
                <span className="font-extrabold text-[#1C1C1E]">{s.amount} {result.currency || 'USD'}</span>
              </div>
              {s.code && (
                <div className="bg-[#FFFFFF] border border-[#E5E5EA] rounded-2xl p-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase font-semibold text-[#8E8E93] tracking-wider mb-0.5">Their claim code</p>
                    <code className="text-base font-mono font-bold tracking-wider text-[#1C1C1E] break-all">{s.code}</code>
                  </div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(s.code)}
                    className="text-xs px-3.5 py-2 rounded-xl font-semibold bg-[#000000] text-white hover:bg-[#1C1C1E] transition-colors"
                  >
                    Copy
                  </button>
                </div>
              )}
              {s.status && (
                <p className="text-[11px] text-[#8E8E93] mt-2 font-medium">
                  Status: {s.status}{s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-[#8E8E93] text-center mb-6">
          Unclaimed splits can be refunded from history after expiry.
        </p>

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

      <h2 className="text-2xl font-bold text-[#1C1C1E] mb-1">Split Payment</h2>
      <p className="text-sm text-[#8E8E93] mb-6">
        Split money between multiple people. Each gets a claim code.
      </p>

      {/* Split mode toggle */}
      <div className="flex gap-2 p-1 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl mb-6">
        <button
          onClick={() => setSplitMode('equal')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${splitMode === 'equal' ? 'bg-[#000000] text-white shadow-sm' : 'text-[#8E8E93] hover:text-[#1C1C1E]'}`}
        >
          Equal Split
        </button>
        <button
          onClick={() => setSplitMode('custom')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all ${splitMode === 'custom' ? 'bg-[#000000] text-white shadow-sm' : 'text-[#8E8E93] hover:text-[#1C1C1E]'}`}
        >
          Custom Amounts
        </button>
      </div>

      {/* Total amount (only for equal mode) */}
      {splitMode === 'equal' && (
        <div className="mb-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block">Total Amount</label>
              <input
                type="number"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="100"
                className="w-full px-4 py-3.5 rounded-2xl text-lg font-semibold bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-3.5 rounded-2xl text-lg font-semibold bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
              >
                <option value="USD">USD</option>
                <option value="INR">INR</option>
                <option value="EUR">EUR</option>
                <option value="NGN">NGN</option>
              </select>
            </div>
          </div>
          {equalAmount && recipients.length > 0 && (
            <p className="text-xs text-[#8E8E93] mt-2">
              = {equalAmount} {currency} each × {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
            </p>
          )}
        </div>
      )}

      {/* Currency selector for custom mode */}
      {splitMode === 'custom' && (
        <div className="mb-5">
          <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider mb-2 block">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full px-4 py-3.5 rounded-2xl font-semibold bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000] transition-colors"
          >
            <option value="USD">USD</option>
            <option value="INR">INR</option>
            <option value="EUR">EUR</option>
            <option value="NGN">NGN</option>
          </select>
        </div>
      )}

      {/* Recipients */}
      <div className="space-y-3 mb-4">
        <label className="text-xs font-semibold text-[#8E8E93] uppercase tracking-wider block">Recipients</label>
        {recipients.map((r, i) => (
          <div key={i} className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl p-3.5 shadow-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93] text-sm">@</span>
                <input
                  value={r.username}
                  onChange={(e) => updateRecipient(i, 'username', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  onBlur={() => lookupUser(i)}
                  onKeyDown={(e) => e.key === 'Enter' && lookupUser(i)}
                  placeholder="username"
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm bg-white border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000]"
                />
              </div>
              {splitMode === 'custom' && (
                <input
                  type="number"
                  value={r.amount}
                  onChange={(e) => updateRecipient(i, 'amount', e.target.value)}
                  placeholder={currency}
                  className="w-24 px-3 py-2.5 rounded-xl text-sm bg-white border border-[#E5E5EA] text-[#1C1C1E] focus:outline-none focus:border-[#000000]"
                />
              )}
              {recipients.length > 1 && (
                <button onClick={() => removeRecipient(i)} className="text-[#8E8E93] hover:text-[#1C1C1E] text-xl px-1.5">×</button>
              )}
            </div>

            {/* Status */}
            {lookingUp[i] && (
              <p className="text-xs text-[#8E8E93] animate-pulse">Looking up...</p>
            )}
            {r.resolved && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1C1C1E]">
                <span>✓</span>
                <span>{r.resolved.displayName || r.resolved.username}</span>
                <span className="text-[#8E8E93]">·</span>
                <span className="text-[#8E8E93] font-mono">{r.resolved.address.slice(0, 8)}...</span>
                <span className="text-[#8E8E93]">·</span>
                <span className="text-[#8E8E93]">{r.resolved.baseCurrency}</span>
              </div>
            )}
            {r.error && (
              <p className="text-xs text-[#1C1C1E] font-semibold">{r.error}</p>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={addRecipient}
        disabled={recipients.length >= 10}
        className="w-full py-3 border border-dashed border-[#E5E5EA] bg-[#F2F2F7] rounded-2xl text-xs font-semibold mb-6 disabled:opacity-40 text-[#1C1C1E] hover:bg-[#E5E5EA] transition-colors"
      >
        + Add Recipient {recipients.length >= 10 && '(max 10)'}
      </button>

      {/* Summary */}
      {parseFloat(computedTotal) > 0 && allResolved && (
        <div className="bg-[#F2F2F7] border border-[#E5E5EA] rounded-3xl p-5 mb-6 shadow-sm">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-[#8E8E93]">Total</span>
            <span className="font-extrabold text-[#1C1C1E]">{computedTotal} {currency}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-[#8E8E93]">Recipients</span>
            <span className="font-semibold text-[#1C1C1E]">{recipients.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#8E8E93]">Each gets</span>
            <span className="font-semibold text-[#1C1C1E]">{splitMode === 'equal' ? equalAmount : 'Custom'} {currency}</span>
          </div>
          <p className="text-xs text-[#8E8E93] mt-3 pt-3 border-t border-[#E5E5EA]">
            Each person gets a 10-character claim code. Unclaimed funds can be refunded after expiry.
          </p>
        </div>
      )}

      {error && <p className="text-[#1C1C1E] font-semibold text-sm bg-[#F2F2F7] border border-[#E5E5EA] p-3 rounded-xl mb-4">{error}</p>}

      <button
        onClick={handleSplit}
        disabled={!canSend}
        className="w-full py-4 rounded-2xl font-semibold bg-[#000000] text-white hover:bg-[#1C1C1E] disabled:opacity-40 transition-all shadow-sm"
      >
        {sending ? 'Creating escrows...' : `Split ${computedTotal || '0'} ${currency}`}
      </button>
    </div>
  );
}