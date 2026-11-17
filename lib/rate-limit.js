import 'server-only';
import { ApiError } from './api.js';
import { safeLog } from './logger.js';
import { createAdminClient } from './supabase/admin.js';

export function getClientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function enforceRateLimit({
  key,
  limit,
  windowSeconds,
  failClosed = false,
}) {
  if (!key || key.length > 200 || !Number.isInteger(limit) || !Number.isInteger(windowSeconds)) {
    throw new Error('Invalid rate limit configuration');
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) throw error;
    if (data !== true) {
      throw new ApiError(429, 'Too many requests', {
        'Retry-After': String(windowSeconds),
      });
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;

    safeLog('error', 'rate_limit.failed', { code: err?.code || err?.name });
    if (failClosed) {
      throw new ApiError(503, 'Service temporarily unavailable');
    }
  }
}

export async function enforceUserAndIpRateLimit(
  req,
  userId,
  scope,
  { userLimit, ipLimit, windowSeconds, failClosed = true }
) {
  await enforceRateLimit({
    key: `user:${userId}:${scope}`,
    limit: userLimit,
    windowSeconds,
    failClosed,
  });

  await enforceRateLimit({
    key: `ip:${getClientIp(req)}:${scope}`,
    limit: ipLimit,
    windowSeconds,
    failClosed,
  });
}
