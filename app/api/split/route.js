import { ApiError, readJson, readQuery, withApi } from '@/lib/api';
import { requireSigningWallet, requireUser } from '@/lib/auth';
import { safeLog } from '@/lib/logger';
import {
  claimEscrow,
  compensateEscrow,
  createEscrow,
  listIncomingEscrows,
} from '@/lib/escrow-service';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { resolveRecipient } from '@/lib/recipients';
import { getUserSigner } from '@/lib/signing/server-signer';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrencyBalance } from '@/lib/xrpl-wallet';
import { splitClaimSchema, splitCreateSchema, splitListQuerySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function signerFor(userId, walletRecord) {
  try {
    return getUserSigner(userId, walletRecord);
  } catch {
    throw new ApiError(503, 'Signing is temporarily unavailable');
  }
}

async function findGroup(groupId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('split_groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();

  if (error) {
    safeLog('error', 'split.group_lookup_failed', { code: error.code });
    throw new ApiError(500, 'Unable to load split');
  }

  return data;
}

async function groupEscrows(groupId) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('escrows')
    .select('id, amount, currency, status, expires_at, destination_user_id, destination_address, split_group_id, owner_user_id')
    .eq('split_group_id', groupId)
    .order('created_at', { ascending: true });

  if (error) {
    safeLog('error', 'split.escrow_list_failed', { code: error.code });
    throw new ApiError(500, 'Unable to load split');
  }

  return data || [];
}

async function duplicateGroupResponse(group) {
  if (group.status !== 'ACTIVE') {
    throw new ApiError(409, 'This split is already being processed');
  }

  const rows = await groupEscrows(group.id);
  return {
    success: true,
    duplicate: true,
    codesUnavailable: true,
    groupId: group.id,
    totalAmount: String(group.total_amount),
    currency: group.currency,
    splitCount: rows.length,
    splits: rows.map((row) => ({
      escrowId: row.id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      expiresAt: row.expires_at,
    })),
  };
}

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireSigningWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'split:create', {
      userLimit: 5,
      ipLimit: 10,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, splitCreateSchema, 16 * 1024);

    const recipients = [];
    for (const entry of body.splits) {
      const recipient = await resolveRecipient(entry.to, { requireRegistered: true });
      if (!recipient) throw new ApiError(404, 'Recipient not found');
      recipients.push({ ...recipient, amount: entry.amount });
    }

    const addresses = new Set(recipients.map((recipient) => recipient.address));
    if (addresses.size !== recipients.length) {
      throw new ApiError(400, 'Each split recipient must be unique');
    }
    if (addresses.has(wallet.address)) {
      throw new ApiError(400, 'You cannot include yourself in a split');
    }

    const totalAmount = recipients
      .reduce((sum, recipient) => sum + Number(recipient.amount), 0)
      .toFixed(6);

    let balance;
    try {
      balance = await getCurrencyBalance(wallet.address, body.currency);
    } catch {
      throw new ApiError(502, 'Unable to read wallet balance');
    }

    if (Number(balance) < Number(totalAmount)) {
      throw new ApiError(400, 'Insufficient balance');
    }

    const admin = createAdminClient();
    const { data: existingGroup } = await admin
      .from('split_groups')
      .select('*')
      .eq('owner_user_id', user.id)
      .eq('idempotency_key', body.idempotencyKey)
      .maybeSingle();

    if (existingGroup) return duplicateGroupResponse(existingGroup);

    const { data: group, error: groupError } = await admin
      .from('split_groups')
      .insert({
        owner_user_id: user.id,
        idempotency_key: body.idempotencyKey,
        currency: body.currency,
        total_amount: totalAmount,
        status: 'CREATING',
      })
      .select('*')
      .single();

    if (groupError) {
      if (groupError.code === '23505') {
        const duplicate = await admin
          .from('split_groups')
          .select('*')
          .eq('owner_user_id', user.id)
          .eq('idempotency_key', body.idempotencyKey)
          .maybeSingle();
        if (duplicate.data) return duplicateGroupResponse(duplicate.data);
      }
      safeLog('error', 'split.group_create_failed', { code: groupError.code });
      throw new ApiError(500, 'Unable to create split');
    }

    const signer = signerFor(user.id, wallet);
    const results = [];

    try {
      for (let index = 0; index < recipients.length; index += 1) {
        const recipient = recipients[index];
        const result = await createEscrow({
          ownerUserId: user.id,
          ownerWallet: signer.wallet,
          amount: recipient.amount,
          currency: body.currency,
          recipient,
          clientRequestId: `${body.idempotencyKey}:${index}`,
          cancelSeconds: body.cancelSeconds,
          splitGroupId: group.id,
        });
        results.push({
          ...result,
          username: recipient.username,
          displayName: recipient.displayName,
        });
      }
    } catch (error) {
      for (const result of results) {
        try {
          await compensateEscrow({ escrowId: result.escrowId, ownerUserId: user.id });
        } catch (compensationError) {
          safeLog('error', 'split.compensation_failed', {
            escrowId: result.escrowId,
            code: compensationError?.status || compensationError?.name,
          });
        }
      }

      await admin
        .from('split_groups')
        .update({ status: 'FAILED' })
        .eq('id', group.id)
        .eq('status', 'CREATING');

      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'Split failed; locked funds were returned');
    }

    await admin
      .from('split_groups')
      .update({ status: 'ACTIVE' })
      .eq('id', group.id)
      .eq('status', 'CREATING');

    return {
      success: true,
      groupId: group.id,
      totalAmount,
      currency: body.currency,
      splitCount: results.length,
      splits: results.map((result) => ({
        escrowId: result.escrowId,
        username: result.username,
        displayName: result.displayName,
        amount: result.amount,
        code: result.code,
        expiresAt: result.expiresAt,
        txHash: result.txHash,
      })),
    };
  });
}

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'split:list', {
      userLimit: 60,
      ipLimit: 120,
      windowSeconds: 60,
      failClosed: false,
    });

    const query = readQuery(new URL(req.url).searchParams, splitListQuerySchema);

    if (!query.groupId) {
      const incoming = await listIncomingEscrows(user.id);
      return { success: true, splits: incoming.filter((escrow) => escrow.isSplit) };
    }

    const group = await findGroup(query.groupId);
    if (!group) throw new ApiError(404, 'Split not found');

    const rows = await groupEscrows(group.id);
    const isOwner = group.owner_user_id === user.id;
    const isParticipant = rows.some((row) => row.destination_user_id === user.id);

    if (!isOwner && !isParticipant) {
      throw new ApiError(403, 'You do not have permission to view this split');
    }

    return {
      success: true,
      groupId: group.id,
      totalAmount: String(group.total_amount),
      currency: group.currency,
      status: group.status,
      splits: rows.map((row) => ({
        escrowId: row.id,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        expiresAt: row.expires_at,
      })),
    };
  });
}

export async function PUT(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const wallet = await requireSigningWallet(user.id);

    await enforceUserAndIpRateLimit(req, user.id, 'split:claim', {
      userLimit: 10,
      ipLimit: 30,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, splitClaimSchema, 4 * 1024);

    const admin = createAdminClient();
    const { data: escrow } = await admin
      .from('escrows')
      .select('id, split_group_id, destination_user_id')
      .eq('id', body.escrowId)
      .maybeSingle();

    if (!escrow || !escrow.split_group_id) {
      throw new ApiError(404, 'Split not found');
    }
    if (escrow.destination_user_id && escrow.destination_user_id !== user.id) {
      throw new ApiError(403, 'This split belongs to a different recipient');
    }

    const signer = signerFor(user.id, wallet);
    const result = await claimEscrow({
      userId: user.id,
      claimerWallet: signer.wallet,
      code: body.code,
      escrowId: body.escrowId,
    });

    return { success: true, ...result };
  });
}
