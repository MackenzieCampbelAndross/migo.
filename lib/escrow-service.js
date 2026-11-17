import 'server-only';
import { ApiError } from './api.js';
import { safeLog } from './logger.js';
import { createAdminClient } from './supabase/admin.js';
import {
  codeToCondition,
  generateClaimCode,
  hashClaimCode,
} from './security/claim-code.js';
import { decryptSecret, encryptSecret } from './security/seed-vault.js';
import {
  burnTokens,
  cancelTriggerEscrow,
  createTriggerEscrow,
  EscrowError,
  finishTriggerEscrow,
  mintTokensTo,
} from './xrpl-escrow.js';
import { getIssuerSigner } from './signing/server-signer.js';
import { ensureTrustLine } from './xrpl-wallet.js';
import { getClient } from './xrpl-client.js';

const ESCROW_PENDING_STATUSES = ['LOCKED'];
const STALE_CREATING_MS = 5 * 60 * 1000;
const REFUND_DELAY_MS = 3 * 60 * 1000;

function codeAad(userId) {
  return `escrow-code:${userId}`;
}

function toApiError(error) {
  if (error instanceof ApiError) return error;

  if (error instanceof EscrowError) {
    const status = error.code?.startsWith('tecUNFUNDED') || error.code?.startsWith('tecNO_LINE')
      ? 400
      : error.code === 'tecNO_DST_INSUF_XRP'
        ? 503
        : error.code?.startsWith('tecNO_')
          ? 409
          : 502;
    return new ApiError(status, error.message);
  }

  safeLog('error', 'escrow.unexpected_error', { code: error?.name || 'UnknownError' });
  return new ApiError(500, 'Escrow operation failed');
}

async function findEscrowByRequest(ownerUserId, clientRequestId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('escrows')
    .select('*')
    .eq('owner_user_id', ownerUserId)
    .eq('client_request_id', clientRequestId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'escrow.idempotency_read_failed', { code: error.code });
    throw new ApiError(500, 'Unable to create escrow');
  }

  return data;
}

function existingEscrowResponse(escrow, ownerUserId) {
  if (escrow.status === 'LOCKED') {
    let code;
    try {
      code = decryptSecret(escrow.code_encrypted, codeAad(ownerUserId));
    } catch {
      safeLog('error', 'escrow.code_decrypt_failed', { escrowId: escrow.id });
      throw new ApiError(500, 'Unable to recover the escrow code');
    }

    return {
      duplicate: true,
      escrowId: escrow.id,
      code,
      amount: escrow.amount,
      currency: escrow.currency,
      expiresAt: escrow.expires_at,
      recipientUsername: null,
      groupId: escrow.split_group_id,
      txHash: escrow.tx_hash_create,
      status: escrow.status,
    };
  }

  if (escrow.status === 'CREATING' || escrow.status === 'CLAIMING' || escrow.status === 'REFUNDING') {
    throw new ApiError(409, 'This escrow is already being processed');
  }

  if (escrow.status === 'EXPIRED') {
    throw new ApiError(410, 'This escrow has expired');
  }

  throw new ApiError(409, 'This escrow has already been processed');
}

async function tryReturnBurnedValue(escrow) {
  const admin = createAdminClient();

  try {
    const mint = await mintTokensTo({
      destination: escrow.owner_address,
      currency: escrow.currency,
      amount: escrow.amount,
    });

    await admin
      .from('escrows')
      .update({ status: 'REFUNDED', mint_tx_hash: mint.hash })
      .eq('id', escrow.id)
      .in('status', ['CREATING', 'REFUNDING']);

    return true;
  } catch (error) {
    safeLog('error', 'escrow.compensation_failed', {
      escrowId: escrow.id,
      code: error?.code || error?.name,
    });

    await admin
      .from('escrows')
      .update({ status: 'REFUNDING' })
      .eq('id', escrow.id)
      .in('status', ['CREATING', 'REFUNDING']);

    return false;
  }
}

export async function createEscrow({
  ownerUserId,
  ownerWallet,
  amount,
  currency,
  recipient,
  clientRequestId,
  cancelSeconds,
  splitGroupId = null,
}) {
  const admin = createAdminClient();

  const existing = await findEscrowByRequest(ownerUserId, clientRequestId);
  if (existing) return existingEscrowResponse(existing, ownerUserId);

  const code = generateClaimCode();
  const codeHash = hashClaimCode(code);
  const { conditionHex } = codeToCondition(code);
  const codeEncrypted = encryptSecret(code, codeAad(ownerUserId));
  const issuerWallet = getIssuerSigner(currency);
  const expiresAt = new Date(Date.now() + Number(cancelSeconds) * 1000).toISOString();

  const { data: inserted, error: insertError } = await admin
    .from('escrows')
    .insert({
      owner_user_id: ownerUserId,
      owner_address: ownerWallet.address,
      destination_user_id: recipient?.userId || null,
      destination_address: recipient?.address || null,
      amount,
      currency,
      code_hash: codeHash,
      code_encrypted: codeEncrypted,
      condition_hex: conditionHex,
      escrow_issuer_address: issuerWallet.address,
      status: 'CREATING',
      client_request_id: clientRequestId,
      split_group_id: splitGroupId,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const duplicate = await findEscrowByRequest(ownerUserId, clientRequestId);
      if (duplicate) return existingEscrowResponse(duplicate, ownerUserId);
    }

    safeLog('error', 'escrow.insert_failed', { code: insertError.code });
    throw new ApiError(500, 'Unable to create escrow');
  }

  let burn;
  try {
    burn = await burnTokens({ wallet: ownerWallet, currency, amount });
  } catch (error) {
    await admin
      .from('escrows')
      .update({ status: 'FAILED' })
      .eq('id', inserted.id)
      .eq('status', 'CREATING');

    throw toApiError(error);
  }

  await admin
    .from('escrows')
    .update({ burn_tx_hash: burn.hash })
    .eq('id', inserted.id)
    .eq('status', 'CREATING');

  let trigger;
  try {
    trigger = await createTriggerEscrow({
      issuerWallet,
      destinationAddress: recipient?.address || issuerWallet.address,
      conditionHex,
      cancelSeconds,
    });
  } catch (error) {
    await tryReturnBurnedValue({ ...inserted, burn_tx_hash: burn.hash });
    throw toApiError(error);
  }

  const { error: lockError } = await admin
    .from('escrows')
    .update({
      escrow_issuer_address: issuerWallet.address,
      escrow_sequence: trigger.sequence,
      tx_hash_create: trigger.hash,
      status: 'LOCKED',
    })
    .eq('id', inserted.id)
    .eq('status', 'CREATING');

  if (lockError) {
    // The value is locked and the trigger exists; the maintenance job can
    // reconcile the row from CREATING to LOCKED.
    safeLog('error', 'escrow.lock_update_failed', {
      escrowId: inserted.id,
      code: lockError.code,
    });
  }

  return {
    duplicate: false,
    escrowId: inserted.id,
    code,
    amount,
    currency,
    expiresAt,
    recipientUsername: recipient?.username || null,
    groupId: splitGroupId,
    txHash: trigger.hash,
    status: 'LOCKED',
  };
}

export async function claimEscrow({ userId, claimerWallet, code, escrowId }) {
  const admin = createAdminClient();
  const codeHash = hashClaimCode(code);

  let query = admin.from('escrows').select('*').eq('code_hash', codeHash);
  if (escrowId) query = query.eq('id', escrowId);

  const { data: escrow, error } = await query.maybeSingle();

  if (error) {
    safeLog('error', 'escrow.claim_lookup_failed', { code: error.code });
    throw new ApiError(500, 'Unable to look up escrow');
  }

  if (!escrow) throw new ApiError(404, 'Invalid or expired code');

  if (escrow.status === 'CLAIMED') throw new ApiError(409, 'This escrow has already been claimed');
  if (['EXPIRED', 'REFUNDING', 'REFUNDED', 'FAILED'].includes(escrow.status)) {
    throw new ApiError(410, 'This escrow has expired');
  }
  if (escrow.status === 'CLAIMING') throw new ApiError(409, 'This escrow is already being claimed');
  if (escrow.status !== 'LOCKED') throw new ApiError(409, 'This escrow is not claimable');

  if (escrow.destination_user_id && escrow.destination_user_id !== userId) {
    throw new ApiError(403, 'This escrow belongs to a different recipient');
  }

  if (new Date(escrow.expires_at).getTime() <= Date.now()) {
    await admin
      .from('escrows')
      .update({ status: 'EXPIRED' })
      .eq('id', escrow.id)
      .eq('status', 'LOCKED');
    throw new ApiError(410, 'This escrow has expired');
  }

  const { conditionHex, fulfillmentHex } = codeToCondition(code);
  if (conditionHex !== escrow.condition_hex) {
    throw new ApiError(400, 'Invalid claim code');
  }

  const { data: claimed, error: claimError } = await admin
    .from('escrows')
    .update({ status: 'CLAIMING', claimed_by_user_id: userId })
    .eq('id', escrow.id)
    .eq('status', 'LOCKED')
    .select('*')
    .maybeSingle();

  if (claimError) {
    safeLog('error', 'escrow.claim_state_failed', { escrowId: escrow.id, code: claimError.code });
    throw new ApiError(500, 'Unable to start claim');
  }

  if (!claimed) throw new ApiError(409, 'This escrow is no longer claimable');
  if (!claimed.escrow_sequence) {
    await admin
      .from('escrows')
      .update({ status: 'LOCKED', claimed_by_user_id: null })
      .eq('id', claimed.id)
      .eq('status', 'CLAIMING');
    throw new ApiError(503, 'This escrow is still being finalized');
  }

  try {
    await ensureTrustLine(claimerWallet, claimed.currency);
  } catch {
    await admin
      .from('escrows')
      .update({ status: 'LOCKED', claimed_by_user_id: null })
      .eq('id', claimed.id)
      .eq('status', 'CLAIMING');

    throw new ApiError(503, 'Unable to prepare your wallet for this currency');
  }

  let finish;
  try {
    finish = await finishTriggerEscrow({
      claimerWallet,
      ownerAddress: claimed.escrow_issuer_address,
      sequence: claimed.escrow_sequence,
      conditionHex: claimed.condition_hex,
      fulfillmentHex,
    });
  } catch (error) {
    await admin
      .from('escrows')
      .update({ status: 'LOCKED', claimed_by_user_id: null })
      .eq('id', claimed.id)
      .eq('status', 'CLAIMING');

    if (error instanceof EscrowError && ['tecNO_PERMISSION', 'tecNO_TARGET', 'tecNO_ENTRY'].includes(error.code)) {
      await admin
        .from('escrows')
        .update({ status: 'FAILED' })
        .eq('id', claimed.id)
        .eq('status', 'LOCKED');

      safeLog('error', 'escrow.trigger_missing', {
        escrowId: claimed.id,
        code: error.code,
      });
      throw new ApiError(409, 'This escrow can no longer be completed');
    }

    throw toApiError(error);
  }

  // Record the finish hash before minting so a crash cannot strand value in
  // CLAIMING without the maintenance job knowing which escrow was finished.
  await admin
    .from('escrows')
    .update({ tx_hash_finish: finish.hash })
    .eq('id', claimed.id)
    .eq('status', 'CLAIMING');

  try {
    const mint = await mintTokensTo({
      destination: claimerWallet.address,
      currency: claimed.currency,
      amount: claimed.amount,
    });

    await admin
      .from('escrows')
      .update({
        status: 'CLAIMED',
        tx_hash_finish: finish.hash,
        mint_tx_hash: mint.hash,
      })
      .eq('id', claimed.id)
      .eq('status', 'CLAIMING');

    return {
      escrowId: claimed.id,
      hash: finish.hash,
      explorerUrl: finish.explorerUrl,
      amount: claimed.amount,
      currency: claimed.currency,
      status: 'CLAIMED',
    };
  } catch (error) {
    safeLog('error', 'escrow.claim_mint_failed', {
      escrowId: claimed.id,
      code: error?.code || error?.name,
    });

    await admin
      .from('escrows')
      .update({ tx_hash_finish: finish.hash })
      .eq('id', claimed.id)
      .eq('status', 'CLAIMING');

    throw new ApiError(503, 'Claim is being finalized, please retry shortly');
  }
}

async function findTriggerByCondition(issuerAddress, conditionHex) {
  const client = await getClient();
  const result = await client.request({
    command: 'account_objects',
    account: issuerAddress,
    type: 'escrow',
    ledger_index: 'validated',
  });

  const expected = String(conditionHex).toUpperCase();
  return (result.result.account_objects || []).find(
    (entry) => String(entry.Condition || '').toUpperCase() === expected
  ) || null;
}

async function triggerExists(issuerAddress, sequence) {
  if (!sequence) return false;
  const client = await getClient();
  const result = await client.request({
    command: 'account_objects',
    account: issuerAddress,
    type: 'escrow',
    ledger_index: 'validated',
  });

  return (result.result.account_objects || []).some(
    (entry) => Number(entry.Sequence) === Number(sequence)
  );
}

async function finishRefund({ escrow, cancelHash = null }) {
  const admin = createAdminClient();
  const issuerWallet = getIssuerSigner(escrow.currency);

  const exists = await triggerExists(issuerWallet.address, escrow.escrow_sequence);
  let cancel = cancelHash || escrow.tx_hash_finish || null;

  if (exists) {
    const result = await cancelTriggerEscrow({
      issuerWallet,
      sequence: escrow.escrow_sequence,
    });
    cancel = result.hash;

    await admin
      .from('escrows')
      .update({ tx_hash_finish: cancel })
      .eq('id', escrow.id)
      .eq('status', 'REFUNDING');
  }

  const mint = await mintTokensTo({
    destination: escrow.owner_address,
    currency: escrow.currency,
    amount: escrow.amount,
  });

  await admin
    .from('escrows')
    .update({
      status: 'REFUNDED',
      mint_tx_hash: mint.hash,
      tx_hash_finish: cancel,
    })
    .eq('id', escrow.id)
    .eq('status', 'REFUNDING');

  return {
    escrowId: escrow.id,
    hash: cancel,
    amount: escrow.amount,
    currency: escrow.currency,
    status: 'REFUNDED',
  };
}

export async function refundEscrow({ escrowId, userId = null }) {
  const admin = createAdminClient();

  const { data: escrow, error } = await admin
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'escrow.refund_lookup_failed', { code: error.code });
    throw new ApiError(500, 'Unable to load escrow');
  }

  if (!escrow) throw new ApiError(404, 'Escrow not found');
  if (userId && escrow.owner_user_id !== userId) {
    throw new ApiError(403, 'You do not own this escrow');
  }

  if (escrow.status === 'REFUNDED') {
    return {
      duplicate: true,
      escrowId: escrow.id,
      amount: escrow.amount,
      currency: escrow.currency,
      status: 'REFUNDED',
    };
  }
  if (escrow.status === 'CLAIMED') throw new ApiError(409, 'This escrow has already been claimed');
  if (escrow.status === 'REFUNDING') {
    try {
      return await finishRefund({ escrow });
    } catch (err) {
      throw toApiError(err);
    }
  }
  if (!['LOCKED', 'EXPIRED', 'CREATING'].includes(escrow.status)) {
    throw new ApiError(409, 'This escrow is not refundable');
  }

  if (escrow.status === 'LOCKED' && new Date(escrow.expires_at).getTime() + REFUND_DELAY_MS > Date.now()) {
    throw new ApiError(409, 'Refund is not available yet');
  }

  if (escrow.status === 'CREATING' && !escrow.burn_tx_hash) {
    await admin
      .from('escrows')
      .update({ status: 'FAILED' })
      .eq('id', escrow.id)
      .eq('status', 'CREATING');
    throw new ApiError(409, 'This escrow was never funded');
  }

  const { data: refunding, error: stateError } = await admin
    .from('escrows')
    .update({ status: 'REFUNDING' })
    .eq('id', escrow.id)
    .in('status', ['LOCKED', 'EXPIRED', 'CREATING'])
    .select('*')
    .maybeSingle();

  if (stateError) {
    safeLog('error', 'escrow.refund_state_failed', { escrowId: escrow.id, code: stateError.code });
    throw new ApiError(500, 'Unable to start refund');
  }
  if (!refunding) throw new ApiError(409, 'This escrow is not refundable');

  try {
    return await finishRefund({ escrow: refunding });
  } catch (error) {
    await admin
      .from('escrows')
      .update({ status: 'REFUNDING' })
      .eq('id', refunding.id)
      .eq('status', 'REFUNDING');

    const apiError = toApiError(error);
    if (apiError.status === 409 && error instanceof EscrowError && ['tecNO_PERMISSION', 'tecNO_TARGET', 'tecNO_ENTRY'].includes(error.code)) {
      await admin
        .from('escrows')
        .update({ status: 'EXPIRED' })
        .eq('id', refunding.id)
        .eq('status', 'REFUNDING');
    }

    throw apiError;
  }
}

// Used for split compensation and operational rollback. The value is returned
// immediately; the 1-drop trigger may remain until its CancelAfter and is
// cleaned up by the maintenance job.
export async function compensateEscrow({ escrowId, ownerUserId }) {
  const admin = createAdminClient();

  const { data: escrow, error } = await admin
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'escrow.compensate_lookup_failed', { code: error.code });
    throw new ApiError(500, 'Unable to load escrow');
  }
  if (!escrow) throw new ApiError(404, 'Escrow not found');
  if (escrow.owner_user_id !== ownerUserId) {
    throw new ApiError(403, 'You do not own this escrow');
  }
  if (escrow.status === 'REFUNDED') {
    return { duplicate: true, escrowId: escrow.id, status: 'REFUNDED' };
  }
  if (!['LOCKED', 'EXPIRED', 'CREATING'].includes(escrow.status)) {
    throw new ApiError(409, 'This escrow cannot be rolled back');
  }
  if (escrow.status === 'CREATING' && !escrow.burn_tx_hash) {
    await admin
      .from('escrows')
      .update({ status: 'FAILED' })
      .eq('id', escrow.id)
      .eq('status', 'CREATING');
    return { escrowId: escrow.id, status: 'FAILED' };
  }

  const { data: refunding, error: stateError } = await admin
    .from('escrows')
    .update({ status: 'REFUNDING' })
    .eq('id', escrow.id)
    .in('status', ['LOCKED', 'EXPIRED', 'CREATING'])
    .select('*')
    .maybeSingle();

  if (stateError) {
    safeLog('error', 'escrow.compensate_state_failed', {
      escrowId: escrow.id,
      code: stateError.code,
    });
    throw new ApiError(500, 'Unable to roll back escrow');
  }
  if (!refunding) throw new ApiError(409, 'This escrow cannot be rolled back');

  try {
    const mint = await mintTokensTo({
      destination: refunding.owner_address,
      currency: refunding.currency,
      amount: refunding.amount,
    });

    await admin
      .from('escrows')
      .update({ status: 'REFUNDED', mint_tx_hash: mint.hash })
      .eq('id', refunding.id)
      .eq('status', 'REFUNDING');

    if (refunding.escrow_sequence) {
      try {
        const issuerWallet = getIssuerSigner(refunding.currency);
        if (await triggerExists(issuerWallet.address, refunding.escrow_sequence)) {
          const cancel = await cancelTriggerEscrow({
            issuerWallet,
            sequence: refunding.escrow_sequence,
          });
          await admin
            .from('escrows')
            .update({ tx_hash_finish: cancel.hash })
            .eq('id', refunding.id);
        }
      } catch (error) {
        safeLog('warn', 'escrow.compensation_trigger_pending', {
          escrowId: refunding.id,
          code: error?.code || error?.name,
        });
      }
    }

    return { escrowId: refunding.id, status: 'REFUNDED', amount: refunding.amount, currency: refunding.currency };
  } catch (error) {
    safeLog('error', 'escrow.compensation_mint_failed', {
      escrowId: refunding.id,
      code: error?.code || error?.name,
    });
    throw new ApiError(503, 'Rollback is being finalized');
  }
}

export async function listIncomingEscrows(userId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('escrows')
    .select('id, destination_user_id, amount, currency, status, expires_at, created_at, split_group_id, owner_user_id')
    .eq('destination_user_id', userId)
    .in('status', ['LOCKED', 'EXPIRED'])
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    safeLog('error', 'escrow.list_failed', { userId, code: error.code });
    throw new ApiError(500, 'Unable to load escrows');
  }

  const ownerIds = [...new Set((data || []).map((row) => row.owner_user_id))];
  let owners = new Map();
  if (ownerIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, username')
      .in('id', ownerIds);
    owners = new Map((profiles || []).map((profile) => [profile.id, profile.username]));
  }

  return (data || []).map((row) => ({
    id: row.id,
    groupId: row.split_group_id,
    senderUsername: owners.get(row.owner_user_id) || 'unknown',
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    isSplit: Boolean(row.split_group_id),
  }));
}

async function reconcileCreating(escrow) {
  const admin = createAdminClient();

  if (escrow.escrow_sequence) {
    await admin
      .from('escrows')
      .update({ status: 'LOCKED' })
      .eq('id', escrow.id)
      .eq('status', 'CREATING');
    return 'locked';
  }

  if (!escrow.burn_tx_hash) {
    await admin
      .from('escrows')
      .update({ status: 'FAILED' })
      .eq('id', escrow.id)
      .eq('status', 'CREATING');
    return 'failed';
  }

  const issuerWallet = getIssuerSigner(escrow.currency);

  try {
    const existing = await findTriggerByCondition(issuerWallet.address, escrow.condition_hex);
    if (existing) {
      await admin
        .from('escrows')
        .update({
          escrow_sequence: Number(existing.Sequence),
          tx_hash_create: existing.PreviousTxnID || null,
          status: 'LOCKED',
        })
        .eq('id', escrow.id)
        .eq('status', 'CREATING');
      return 'locked';
    }

    const trigger = await createTriggerEscrow({
      issuerWallet,
      destinationAddress: escrow.destination_address || issuerWallet.address,
      conditionHex: escrow.condition_hex,
      cancelSeconds: 60,
    });

    await admin
      .from('escrows')
      .update({
        escrow_sequence: trigger.sequence,
        tx_hash_create: trigger.hash,
        status: 'LOCKED',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq('id', escrow.id)
      .eq('status', 'CREATING');

    return 'locked';
  } catch (error) {
    safeLog('error', 'escrow.reconcile_trigger_failed', {
      escrowId: escrow.id,
      code: error?.code || error?.name,
    });
    await tryReturnBurnedValue(escrow);
    return 'refunded';
  }
}

export async function processEscrowMaintenance({ limit = 20 } = {}) {
  const admin = createAdminClient();
  const result = { expired: 0, refunded: 0, minted: 0, reconciled: 0, failed: 0 };

  const { data: expired } = await admin
    .from('escrows')
    .select('id')
    .in('status', ['LOCKED', 'EXPIRED'])
    .lt('expires_at', new Date(Date.now() - REFUND_DELAY_MS).toISOString())
    .limit(limit);

  for (const row of expired || []) {
    try {
      await refundEscrow({ escrowId: row.id });
      result.refunded += 1;
    } catch (error) {
      result.failed += 1;
      safeLog('error', 'escrow.maintenance_refund_failed', {
        escrowId: row.id,
        status: error?.status,
      });
    }
  }

  const { data: refunding } = await admin
    .from('escrows')
    .select('*')
    .eq('status', 'REFUNDING')
    .limit(limit);

  for (const row of refunding || []) {
    try {
      await finishRefund({ escrow: row });
      result.refunded += 1;
    } catch (error) {
      result.failed += 1;
      safeLog('error', 'escrow.maintenance_refund_retry_failed', {
        escrowId: row.id,
        code: error?.code || error?.name,
      });
    }
  }

  const { data: claiming } = await admin
    .from('escrows')
    .select('*')
    .eq('status', 'CLAIMING')
    .not('tx_hash_finish', 'is', null)
    .is('mint_tx_hash', null)
    .limit(limit);

  for (const row of claiming || []) {
    try {
      const { data: wallet } = await admin
        .from('wallets')
        .select('address')
        .eq('user_id', row.claimed_by_user_id)
        .maybeSingle();

      if (!wallet) throw new Error('Claimer wallet missing');

      const mint = await mintTokensTo({
        destination: wallet.address,
        currency: row.currency,
        amount: row.amount,
      });

      await admin
        .from('escrows')
        .update({ status: 'CLAIMED', mint_tx_hash: mint.hash })
        .eq('id', row.id)
        .eq('status', 'CLAIMING');

      result.minted += 1;
    } catch (error) {
      result.failed += 1;
      safeLog('error', 'escrow.maintenance_mint_failed', {
        escrowId: row.id,
        code: error?.code || error?.name,
      });
    }
  }

  const { data: creating } = await admin
    .from('escrows')
    .select('*')
    .eq('status', 'CREATING')
    .lt('updated_at', new Date(Date.now() - STALE_CREATING_MS).toISOString())
    .limit(limit);

  for (const row of creating || []) {
    try {
      const outcome = await reconcileCreating(row);
      if (outcome === 'locked' || outcome === 'refunded') result.reconciled += 1;
      if (outcome === 'failed') result.failed += 1;
    } catch (error) {
      result.failed += 1;
      safeLog('error', 'escrow.maintenance_reconcile_failed', {
        escrowId: row.id,
        code: error?.code || error?.name,
      });
    }
  }

  // Compensated escrows may still have an orphaned 1-drop trigger because
  // EscrowCancel is only valid after CancelAfter.
  const { data: orphans } = await admin
    .from('escrows')
    .select('*')
    .eq('status', 'REFUNDED')
    .not('escrow_sequence', 'is', null)
    .is('tx_hash_finish', null)
    .lt('expires_at', new Date().toISOString())
    .limit(limit);

  for (const row of orphans || []) {
    try {
      const issuerWallet = getIssuerSigner(row.currency);
      if (await triggerExists(issuerWallet.address, row.escrow_sequence)) {
        const cancel = await cancelTriggerEscrow({
          issuerWallet,
          sequence: row.escrow_sequence,
        });
        await admin
          .from('escrows')
          .update({ tx_hash_finish: cancel.hash })
          .eq('id', row.id)
          .eq('status', 'REFUNDED');
      }
    } catch (error) {
      safeLog('warn', 'escrow.maintenance_orphan_trigger_failed', {
        escrowId: row.id,
        code: error?.code || error?.name,
      });
    }
  }

  return result;
}
