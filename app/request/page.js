// app/request/page.js
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../components/WalletProvider';
import { apiFetch } from '@/lib/client-api';
import { normalizeClaimCode } from '@/lib/claim-code-format';

export default function Request() {
  const { wallet } = useWallet();
  const router = useRouter();
  const [tab, setTab] = useState('claims'); // 'claims' | 'incoming' | 'create'
  const [requests, setRequests] = useState([]);
  const [pendingEscrows, setPendingEscrows] = useState([]);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Inline claim state
  const [claimingId, setClaimingId] = useState(null);
  const [claimCode, setClaimCode] = useState('');
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState(null); // { id, amount, explorerUrl }
  // Standalone code claim (no escrow card needed)
  const [directCode, setDirectCode] = useState('');
  const [directClaimError, setDirectClaimError] = useState('');
  const [directClaiming, setDirectClaiming] = useState(false);

  const fetchRequests = useCallback(async () => {
    if (!wallet) return;
    try {
      const data = await apiFetch('/api/request');
      if (data.success) setRequests(data.requests);
    } catch { /* handled by the page state */ }
  }, [wallet]);

  const fetchSplits = useCallback(async () => {
    if (!wallet) return;
    try {
      const data = await apiFetch('/api/escrow');
      if (data.success) setPendingEscrows(data.escrows);
    } catch { /* handled by the page state */ }
  }, [wallet]);

  useEffect(() => {
    if (!wallet) { router.push('/'); return; }
    fetchRequests();
    fetchSplits();
  }, [wallet, router, fetchRequests, fetchSplits]);

  const createRequest = async () => {
    setSending(true);
    setError('');
    try {
      const data = await apiFetch('/api/request', {
        method: 'POST',
        body: JSON.stringify({ to: toAddress.trim(), amount, currency }),
      });
      if (data.success) {
        setToAddress('');
        setAmount('');
        setTab('incoming');
        fetchRequests();
      }
    } catch (err) {
      setError(err.message || 'Failed to create request');
    }
    setSending(false);
  };

  const approveRequest = async (req) => {
    setSending(true);
    setError('');
    try {
      await apiFetch('/api/request', {
        method: 'PUT',
        body: JSON.stringify({ requestId: req.id, action: 'approved' }),
      });
      fetchRequests();
    } catch (err) {
      setError(err.message || 'Failed to process request');
    }
    setSending(false);
  };

  const declineRequest = async (req) => {
    setError('');
    try {
      await apiFetch('/api/request', {
        method: 'PUT',
        body: JSON.stringify({ requestId: req.id, action: 'declined' }),
      });
      fetchRequests();
    } catch (err) {
      setError(err.message || 'Failed to decline request');
    }
  };

  const handleClaim = async (escrow) => {
    setClaimError('');
    setSending(true);
    try {
      // Use the appropriate API based on whether it's a split or standalone escrow
      const apiUrl = escrow.isSplit ? '/api/split' : '/api/escrow';
      const body = escrow.isSplit
        ? { escrowId: escrow.id, code: claimCode }
        : { code: claimCode };

      const data = await apiFetch(apiUrl, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (data.success) {
        setClaimSuccess({ id: escrow.id, amount: data.amount, currency: data.currency, explorerUrl: data.explorerUrl });
        setClaimingId(null);
        setClaimCode('');
        fetchSplits();
      }
    } catch (err) {
      setClaimError(err.message || 'Claim failed');
    }
    setSending(false);
  };

  // Direct claim by code — no escrow card needed
  const handleDirectClaim = async () => {
    setDirectClaimError('');
    setDirectClaiming(true);
    try {
      const data = await apiFetch('/api/escrow', {
        method: 'PUT',
        body: JSON.stringify({ code: directCode }),
      });
      if (data.success) {
        setClaimSuccess({ amount: data.amount, currency: data.currency, explorerUrl: data.explorerUrl });
        setDirectCode('');
        fetchSplits();
      }
    } catch (err) {
      setDirectClaimError(err.message || 'Claim failed');
    }
    setDirectClaiming(false);
  };

  if (!wallet) return null;

  const incoming = requests.filter((r) => r.direction === 'incoming' && r.status === 'pending');

  const claimsBadge = pendingEscrows.length;

  return (
    <div className="px-4 pt-6 pb-28">
      {/* Header */}
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

      <h2 className="text-3xl font-extrabold text-[#1C1C1E] tracking-tight mb-6">Requests</h2>

      {/* Pill Tabs (Segmented Control) */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('claims')}
          className={`flex-1 py-3 px-4 rounded-full text-sm font-semibold relative transition-all ${
            tab === 'claims'
              ? 'bg-[#000000] text-white shadow-sm'
              : 'bg-[#F2F2F7] text-[#1C1C1E] border border-[#E5E5EA] hover:bg-[#E5E5EA]'
          }`}
        >
          Claims
          {claimsBadge > 0 && (
            <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center ${
              tab === 'claims' ? 'bg-white text-[#000000]' : 'bg-[#000000] text-white'
            }`}>
              {claimsBadge}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('incoming')}
          className={`flex-1 py-3 px-4 rounded-full text-sm font-semibold transition-all ${
            tab === 'incoming'
              ? 'bg-[#000000] text-white shadow-sm'
              : 'bg-[#F2F2F7] text-[#1C1C1E] border border-[#E5E5EA] hover:bg-[#E5E5EA]'
          }`}
        >
          Incoming ({incoming.length})
        </button>
        <button
          onClick={() => setTab('create')}
          className={`flex-1 py-3 px-4 rounded-full text-sm font-semibold transition-all ${
            tab === 'create'
              ? 'bg-[#000000] text-white shadow-sm'
              : 'bg-[#F2F2F7] text-[#1C1C1E] border border-[#E5E5EA] hover:bg-[#E5E5EA]'
          }`}
        >
          Request
        </button>
      </div>

      {/* ───── CLAIMS TAB ───── */}
      {tab === 'claims' && (
        <div className="space-y-4">

          {/* Claim success banner */}
          {claimSuccess && (
            <div className="card rounded-3xl p-5 bg-[#F2F2F7] border border-[#E5E5EA]">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-bold text-[#1C1C1E]">{claimSuccess.amount} {claimSuccess.currency || 'USD'} claimed</span>
              </div>
              <a
                href={claimSuccess.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#1C1C1E] font-semibold underline"
              >
                View on XRPL Explorer →
              </a>
              <button onClick={() => setClaimSuccess(null)} className="block text-xs text-[#8E8E93] mt-2 font-medium">Dismiss</button>
            </div>
          )}

          {/* ── Always-visible: Claim by Code Card (Matching Reference Image 3) ── */}
          <div className="card rounded-3xl p-6 bg-[#F2F2F7] border border-[#E5E5EA]">
            <p className="text-base font-bold text-[#1C1C1E] mb-0.5">Claim by Code</p>
            <p className="text-xs text-[#8E8E93] font-medium mb-4">Enter the 10-character code to receive funds.</p>
            <input
              value={directCode}
              onChange={(e) => setDirectCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 11))}
              placeholder="XXXXX-XXXXX"
              maxLength={11}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-4 py-3.5 rounded-2xl text-center text-xl font-mono tracking-[0.2em] input-field bg-[#FFFFFF] border-[#E5E5EA] text-[#1C1C1E] mb-4"
            />
            {directClaimError && <p className="text-xs text-[#1C1C1E] font-semibold mb-3">{directClaimError}</p>}
            <button
              onClick={handleDirectClaim}
              disabled={directClaiming || normalizeClaimCode(directCode).length !== 10}
              className="w-full py-4 rounded-2xl font-semibold text-sm disabled:opacity-40 bg-[#000000] text-white shadow-sm active:scale-[0.98] transition-transform"
            >
              {directClaiming ? 'Claiming...' : 'Claim'}
            </button>
          </div>

          {/* ── Pending escrows addressed to this user ── */}
          {pendingEscrows.length > 0 && (
            <p className="text-xs text-[#8E8E93] font-semibold uppercase tracking-wider mt-6 mb-2">Pending for you</p>
          )}
          {pendingEscrows.map((escrow) => {
            const expired = new Date() > new Date(escrow.expiresAt);
            const isClaiming = claimingId === escrow.id;
            const timeLeft = Math.max(0, Math.floor((new Date(escrow.expiresAt) - Date.now()) / 1000));
            const mins = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;

            return (
              <div key={escrow.id} className="card rounded-3xl p-5 bg-[#F2F2F7] border border-[#E5E5EA]">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-bold text-[#1C1C1E]">
                      {escrow.isSplit ? 'Split' : 'Code send'} from <span className="text-[#000000]">@{escrow.senderUsername}</span>
                    </p>
                    <p className="text-xs text-[#8E8E93] mt-0.5 font-medium">
                      {expired
                        ? <span className="text-[#1C1C1E] font-semibold">Expired — refund available to sender</span>
                        : <>Expires in <span className="font-mono font-semibold text-[#1C1C1E]">{mins}:{secs.toString().padStart(2, '0')}</span></>
                      }
                    </p>
                  </div>
                  <p className="font-extrabold text-lg text-[#1C1C1E]">{escrow.amount} <span className="text-xs text-[#8E8E93] font-medium">XRP</span></p>
                </div>

                {!isClaiming && !expired && (
                  <button
                    onClick={() => { setClaimingId(escrow.id); setClaimCode(''); setClaimError(''); }}
                    className="w-full py-3.5 rounded-2xl text-sm font-semibold bg-[#000000] text-white shadow-sm active:scale-[0.98] transition-transform"
                  >
                    Claim
                  </button>
                )}

                {isClaiming && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-[#8E8E93] font-medium">Enter the 10-character code from the sender:</p>
                    <input
                      value={claimCode}
                      onChange={(e) => setClaimCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 11))}
                      placeholder="XXXXX-XXXXX"
                      maxLength={11}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full px-4 py-3 rounded-2xl text-center text-xl font-mono tracking-[0.2em] input-field bg-[#FFFFFF] border-[#E5E5EA] text-[#1C1C1E]"
                      autoFocus
                    />
                    {claimError && <p className="text-xs text-[#1C1C1E] font-semibold">{claimError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleClaim(escrow)}
                        disabled={sending || normalizeClaimCode(claimCode).length !== 10}
                        className="flex-1 py-3 rounded-2xl text-sm font-semibold disabled:opacity-40 bg-[#000000] text-white shadow-sm"
                      >
                        {sending ? 'Claiming...' : 'Confirm & Claim'}
                      </button>
                      <button
                        onClick={() => { setClaimingId(null); setClaimCode(''); setClaimError(''); }}
                        className="py-3 px-4 rounded-2xl text-sm font-semibold text-[#1C1C1E] bg-[#E5E5EA]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ───── INCOMING TAB ───── */}
      {tab === 'incoming' && (
        <div className="space-y-3">
          {incoming.length === 0 && (
            <div className="card rounded-3xl p-8 text-center bg-[#F2F2F7] border border-[#E5E5EA]">
              <p className="text-sm text-[#8E8E93] font-medium">No pending requests</p>
            </div>
          )}
          {incoming.map((req) => (
            <div key={req.id} className="card rounded-3xl p-5 bg-[#F2F2F7] border border-[#E5E5EA]">
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-mono text-[#8E8E93] font-medium">{req.fromAddress.slice(0, 12)}...</p>
                <p className="font-extrabold text-[#1C1C1E] text-base">{req.amount} {req.currency}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => approveRequest(req)}
                  disabled={sending}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold disabled:opacity-40 bg-[#000000] text-white shadow-sm"
                >
                  Approve & Pay
                </button>
                <button
                  onClick={() => declineRequest(req)}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold text-[#1C1C1E] bg-[#E5E5EA]"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ───── CREATE TAB ───── */}
      {tab === 'create' && (
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">Request from (@username or address)</label>
            <input
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder="@username or rXXXXXXXXX..."
              className="w-full px-4 py-3.5 rounded-2xl font-mono text-sm input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100.00"
                className="w-full px-4 py-3.5 rounded-2xl input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E] font-semibold"
              />
            </div>
            <div>
              <label className="text-xs text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-4 py-3.5 rounded-2xl input-field bg-[#F2F2F7] border-[#E5E5EA] text-[#1C1C1E] font-bold"
              >
                <option value="USD">USD</option>
                <option value="INR">INR</option>
                <option value="EUR">EUR</option>
                <option value="NGN">NGN</option>
              </select>
            </div>
          </div>
          {error && <p className="text-[#1C1C1E] text-sm font-semibold p-3 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl">{error}</p>}
          <button
            onClick={createRequest}
            disabled={sending || !toAddress || !amount}
            className="w-full py-4 rounded-2xl font-semibold disabled:opacity-40 bg-[#000000] text-white shadow-sm active:scale-[0.98] transition-transform"
          >
            {sending ? 'Sending...' : 'Send Request'}
          </button>
        </div>
      )}
    </div>
  );
}
