import { ApiError, readJson, withApi } from '@/lib/api';
import { requireSigningWallet, requireUser } from '@/lib/auth';
import { safeLog } from '@/lib/logger';
import { executePayment } from '@/lib/payment-service';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { resolveRecipient } from '@/lib/recipients';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestActionSchema, requestCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function mapRequests(rows, currentUserId) {
  if (!rows || rows.length === 0) return [];
  const admin = createAdminClient();
  const userIds = [...new Set(rows.flatMap((row) => [row.requester_id, row.payer_id]))];

  const [{ data: profiles }, { data: wallets }] = await Promise.all([
    admin.from('profiles').select('id, username, display_name').in('id', userIds),
    admin.from('wallets').select('user_id, address').in('user_id', userIds),
  ]);

  const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
  const walletMap = new Map((wallets || []).map((row) => [row.user_id, row]));

  return rows.map((row) => {
    const requesterProfile = profileMap.get(row.requester_id);
    const payerProfile = profileMap.get(row.payer_id);
    const requesterWallet = walletMap.get(row.requester_id);
    const payerWallet = walletMap.get(row.payer_id);

    return {
      id: row.id,
      fromAddress: requesterWallet?.address || null,
      toAddress: payerWallet?.address || null,
      fromUsername: requesterProfile?.username || null,
      toUsername: payerProfile?.username || null,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      txHash: row.tx_hash,
      createdAt: row.created_at,
      direction: row.payer_id === currentUserId ? 'incoming' : 'outgoing',
    };
  });
}

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'request:list', {
      userLimit: 60,
      ipLimit: 120,
      windowSeconds: 60,
      failClosed: false,
    });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('payment_requests')
      .select('id, requester_id, payer_id, amount, currency, status, tx_hash, created_at')
      .or(`requester_id.eq.${user.id},payer_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      safeLog('error', 'request.list_failed', { userId: user.id, code: error.code });
      throw new ApiError(500, 'Unable to load requests');
    }

    return { success: true, requests: await mapRequests(data || [], user.id) };
  });
}

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'request:create', {
      userLimit: 10,
      ipLimit: 20,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, requestCreateSchema, 8 * 1024);
    const recipient = await resolveRecipient(body.to, { requireRegistered: true });

    if (!recipient) throw new ApiError(404, 'Recipient not found');
    if (recipient.userId === user.id) throw new ApiError(400, 'You cannot request money from yourself');

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('payment_requests')
      .insert({
        requester_id: user.id,
        payer_id: recipient.userId,
        amount: body.amount,
        currency: body.currency,
      })
      .select('id, requester_id, payer_id, amount, currency, status, tx_hash, created_at')
      .single();

    if (error) {
      safeLog('error', 'request.create_failed', { userId: user.id, code: error.code });
      throw new ApiError(500, 'Unable to create request');
    }

    const [mapped] = await mapRequests([data], user.id);
    return { success: true, request: mapped };
  });
}

export async function PUT(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'request:action', {
      userLimit: 10,
      ipLimit: 20,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, requestActionSchema, 8 * 1024);
    const admin = createAdminClient();

    const { data: request, error } = await admin
      .from('payment_requests')
      .select('id, requester_id, payer_id, amount, currency, status, attempts, tx_hash, created_at')
      .eq('id', body.requestId)
      .maybeSingle();

    if (error) {
      safeLog('error', 'request.lookup_failed', { code: error.code });
      throw new ApiError(500, 'Unable to load request');
    }
    if (!request) throw new ApiError(404, 'Request not found');
    if (request.payer_id !== user.id) throw new ApiError(403, 'You cannot act on this request');
    if (request.status !== 'PENDING') throw new ApiError(409, 'This request has already been handled');

    if (body.action === 'declined') {
      const { data: declined, error: declineError } = await admin
        .from('payment_requests')
        .update({ status: 'DECLINED' })
        .eq('id', request.id)
        .eq('payer_id', user.id)
        .eq('status', 'PENDING')
        .select('id, requester_id, payer_id, amount, currency, status, tx_hash, created_at')
        .maybeSingle();

      if (declineError) {
        safeLog('error', 'request.decline_failed', { code: declineError.code });
        throw new ApiError(500, 'Unable to decline request');
      }
      if (!declined) throw new ApiError(409, 'This request has already been handled');

      const [mapped] = await mapRequests([declined], user.id);
      return { success: true, request: mapped };
    }

    const wallet = await requireSigningWallet(user.id);
    const { data: approved, error: approveError } = await admin
      .from('payment_requests')
      .update({ status: 'APPROVING', attempts: request.attempts + 1 })
      .eq('id', request.id)
      .eq('payer_id', user.id)
      .eq('status', 'PENDING')
      .select('id, requester_id, payer_id, amount, currency, status, attempts, tx_hash, created_at')
      .maybeSingle();

    if (approveError) {
      safeLog('error', 'request.approve_state_failed', { code: approveError.code });
      throw new ApiError(500, 'Unable to approve request');
    }
    if (!approved) throw new ApiError(409, 'This request is already being processed');

    const { data: requesterWallet } = await admin
      .from('wallets')
      .select('address')
      .eq('user_id', approved.requester_id)
      .maybeSingle();

    if (!requesterWallet) {
      await admin
        .from('payment_requests')
        .update({ status: 'PENDING' })
        .eq('id', approved.id)
        .eq('status', 'APPROVING');
      throw new ApiError(409, 'The requester no longer has a wallet');
    }

    let payment;
    try {
      payment = await executePayment({
        userId: user.id,
        walletRecord: wallet,
        toAddress: requesterWallet.address,
        amount: String(approved.amount),
        fromCurrency: approved.currency,
        toCurrency: approved.currency,
        idempotencyKey: `request:${approved.id}:${approved.attempts}`,
      });
    } catch (error) {
      await admin
        .from('payment_requests')
        .update({ status: 'PENDING' })
        .eq('id', approved.id)
        .eq('status', 'APPROVING');
      throw error;
    }

    const { data: completed } = await admin
      .from('payment_requests')
      .update({ status: 'APPROVED', tx_hash: payment.hash || null })
      .eq('id', approved.id)
      .select('id, requester_id, payer_id, amount, currency, status, tx_hash, created_at')
      .maybeSingle();

    const [mapped] = await mapRequests([completed || approved], user.id);
    return { success: true, request: mapped, payment };
  });
}
