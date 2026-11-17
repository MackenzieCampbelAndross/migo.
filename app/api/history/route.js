import * as xrpl from 'xrpl';
import { readQuery, withApi } from '@/lib/api';
import { requireUser, requireWallet } from '@/lib/auth';
import { safeLog } from '@/lib/logger';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { getClient } from '@/lib/xrpl-client';
import { getXrplConfig } from '@/lib/xrpl-config';
import { historyQuerySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MID_RATES_TO_XRP = { USD: 1.36, INR: 125, EUR: 1.17, NGN: 1878 };
const CURRENCY_SYMBOLS = { USD: '$', INR: '\u20b9', EUR: '\u20ac', NGN: '\u20a6' };
const SHOW_TYPES = new Set(['Payment', 'EscrowCreate', 'EscrowFinish']);
const REFUND_DELAY_MS = 3 * 60 * 1000;

function parseDate(tx, wrapper) {
  if (wrapper.close_time_iso) return wrapper.close_time_iso;
  if (tx.date) return new Date((tx.date + 946684800) * 1000).toISOString();
  return null;
}

function feeForPayment(senderChanges, deliveredValue, deliveredCurrency, currencySent, amountSent) {
  if (currencySent === deliveredCurrency || Number(amountSent) <= 0) {
    return `${CURRENCY_SYMBOLS[currencySent] || ''}0.00`;
  }

  const midRate = (MID_RATES_TO_XRP[deliveredCurrency] || 1) / (MID_RATES_TO_XRP[currencySent] || 1);
  const midReceive = Number(amountSent) * midRate;
  const spreadLoss = midReceive - Number(deliveredValue);
  const feeInSender = midRate > 0 ? Math.max(0, spreadLoss / midRate) : 0;
  return `${CURRENCY_SYMBOLS[currencySent] || ''}${feeInSender.toFixed(2)}`;
}

function paymentEntry(tx, meta, hash, date, walletAddress) {
  const delivered = meta.delivered_amount;
  const deliveredValue = typeof delivered === 'string'
    ? xrpl.dropsToXrp(delivered)
    : delivered?.value || '0';
  const deliveredCurrency = typeof delivered === 'string'
    ? 'XRP'
    : delivered?.currency || 'XRP';

  const balanceChanges = xrpl.getBalanceChanges(meta);
  const senderChanges = balanceChanges.find((change) => change.account === tx.Account);
  const senderBalance = senderChanges?.balances || [];

  let amountSent = '0';
  let currencySent = deliveredCurrency;

  const nonXrpChange = senderBalance.find(
    (balance) => balance.currency !== 'XRP' && Number(balance.value) < 0
  );

  if (nonXrpChange) {
    amountSent = Math.abs(Number(nonXrpChange.value)).toFixed(6);
    currencySent = nonXrpChange.currency;
  } else {
    const xrpChange = senderBalance.find((balance) => balance.currency === 'XRP');
    if (xrpChange) {
      const xrpSpent = Math.abs(Number(xrpChange.value));
      const guessedCurrency = deliveredCurrency !== 'XRP' ? deliveredCurrency : 'USD';
      amountSent = (xrpSpent * (MID_RATES_TO_XRP[guessedCurrency] || 1)).toFixed(6);
      currencySent = guessedCurrency;
    }
  }

  if (Number(amountSent) === 0 && Number(deliveredValue) > 0) {
    amountSent = Number(deliveredValue).toFixed(6);
    currencySent = deliveredCurrency;
  }

  return {
    txHash: hash,
    type: 'Payment',
    ledgerType: 'Payment',
    isEscrow: false,
    direction: tx.Account === walletAddress ? 'out' : 'in',
    sender: tx.Account,
    receiver: tx.Destination,
    amountSent,
    currencySent,
    amountReceived: Number(deliveredValue).toFixed(6),
    currencyReceived: deliveredCurrency,
    effectiveRate: Number(amountSent) > 0
      ? (Number(deliveredValue) / Number(amountSent)).toFixed(6)
      : '1',
    fee: feeForPayment(senderChanges, deliveredValue, deliveredCurrency, currencySent, amountSent),
    explorerUrl: `${getXrplConfig().explorerUrl}/transactions/${hash}`,
    createdAt: date,
    escrowId: null,
    escrowStatus: null,
    canRefund: false,
    isSplit: false,
  };
}

function escrowEntry(row, kind, hash, date, userId) {
  const isOwner = row.owner_user_id === userId;
  const isClaimer = row.claimed_by_user_id === userId || row.destination_user_id === userId;
  const expiredLongEnough =
    row.expires_at &&
    Date.now() > new Date(row.expires_at).getTime() + REFUND_DELAY_MS;

  let label = 'Escrow';
  if (kind === 'lock') label = isOwner ? 'Escrow locked' : 'Escrow';
  if (kind === 'finish') label = 'Escrow claimed';
  if (kind === 'mint') label = 'Escrow received';

  const direction = kind === 'lock' ? (isOwner ? 'out' : 'in') : 'in';

  return {
    txHash: hash,
    type: 'Escrow',
    ledgerType: kind,
    label,
    isEscrow: true,
    direction,
    sender: row.owner_address,
    receiver: row.destination_address || null,
    amountSent: String(row.amount),
    currencySent: row.currency,
    amountReceived: String(row.amount),
    currencyReceived: row.currency,
    effectiveRate: '1',
    fee: `${CURRENCY_SYMBOLS[row.currency] || ''}0.00`,
    explorerUrl: `${getXrplConfig().explorerUrl}/transactions/${hash}`,
    createdAt: date,
    escrowId: row.id,
    escrowStatus: row.status,
    canRefund: Boolean(
      isOwner &&
      ['LOCKED', 'EXPIRED'].includes(row.status) &&
      expiredLongEnough
    ),
    isSplit: Boolean(row.split_group_id),
    isOwner,
    isClaimer,
  };
}

function legacyEscrowEntry(tx, hash, date, walletAddress) {
  const amount = typeof tx.Amount === 'string'
    ? xrpl.dropsToXrp(tx.Amount)
    : tx.Amount?.value || '0';

  return {
    txHash: hash,
    type: 'Escrow',
    ledgerType: tx.TransactionType,
    label: 'Legacy escrow',
    isEscrow: true,
    direction: tx.Account === walletAddress ? 'out' : 'in',
    sender: tx.Account,
    receiver: tx.Destination || tx.Owner || null,
    amountSent: amount,
    currencySent: 'XRP',
    amountReceived: amount,
    currencyReceived: 'XRP',
    effectiveRate: '1',
    fee: '0.000012 XRP',
    explorerUrl: `${getXrplConfig().explorerUrl}/transactions/${hash}`,
    createdAt: date,
    escrowId: null,
    escrowStatus: null,
    canRefund: false,
    isSplit: false,
  };
}

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'history:read', {
      userLimit: 60,
      ipLimit: 120,
      windowSeconds: 60,
      failClosed: false,
    });

    const query = readQuery(new URL(req.url).searchParams, historyQuerySchema);
    const client = await getClient();

    const response = await client.request({
      command: 'account_tx',
      account: wallet.address,
      limit: 50,
      ledger_index_min: -1,
      ledger_index_max: -1,
    });

    const raw = (response.result.transactions || []).filter((entry) => {
      if (!entry.meta || typeof entry.meta !== 'object') return false;
      if (entry.meta.TransactionResult !== 'tesSUCCESS') return false;
      if (entry.validated === false) return false;
      const tx = entry.tx_json || entry.tx || entry;
      return SHOW_TYPES.has(tx.TransactionType);
    });

    const hashes = raw
      .map((entry) => {
        const tx = entry.tx_json || entry.tx || entry;
        return tx.hash || entry.hash;
      })
      .filter(Boolean);

    const escrowByHash = new Map();

    if (hashes.length > 0) {
      const admin = createAdminClient();
      const participant = `owner_user_id.eq.${user.id},destination_user_id.eq.${user.id},claimed_by_user_id.eq.${user.id}`;

      const [byBurn, byFinish, byMint] = await Promise.all([
        admin.from('escrows').select('*').or(participant).in('burn_tx_hash', hashes),
        admin.from('escrows').select('*').or(participant).in('tx_hash_finish', hashes),
        admin.from('escrows').select('*').or(participant).in('mint_tx_hash', hashes),
      ]);

      for (const row of byBurn.data || []) {
        if (row.burn_tx_hash) escrowByHash.set(row.burn_tx_hash, { row, kind: 'lock' });
      }
      for (const row of byFinish.data || []) {
        if (row.tx_hash_finish) escrowByHash.set(row.tx_hash_finish, { row, kind: 'finish' });
      }
      for (const row of byMint.data || []) {
        if (row.mint_tx_hash) escrowByHash.set(row.mint_tx_hash, { row, kind: 'mint' });
      }

      if (byBurn.error || byFinish.error || byMint.error) {
        safeLog('error', 'history.escrow_lookup_failed', {
          code: byBurn.error?.code || byFinish.error?.code || byMint.error?.code,
        });
      }
    }

    const transactions = raw.map((entry) => {
      const tx = entry.tx_json || entry.tx || entry;
      const meta = entry.meta;
      const hash = tx.hash || entry.hash;
      const date = parseDate(tx, entry);
      const mapped = hash ? escrowByHash.get(hash) : null;

      if (mapped) {
        // The IOU mint is the value transfer. The 1-drop EscrowFinish is only
        // the on-chain trigger, so skip it to avoid double-counting value.
        if (mapped.kind === 'finish') return null;
        return escrowEntry(mapped.row, mapped.kind, hash, date, user.id);
      }

      if (tx.TransactionType === 'Payment') {
        return paymentEntry(tx, meta, hash, date, wallet.address);
      }

      return legacyEscrowEntry(tx, hash, date, wallet.address);
    });

    return {
      success: true,
      transactions: transactions
        .filter(Boolean)
        .filter((entry) => entry.txHash)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, query.limit),
    };
  });
}
