import crypto from 'node:crypto';
import { ApiError, withApi } from '@/lib/api';
import { processEscrowMaintenance } from '@/lib/escrow-service';
import { safeLog } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    safeLog('error', 'cron.not_configured', {});
    return false;
  }

  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.headers.get('x-cron-secret') || '';

  const expected = Buffer.from(secret, 'utf8');
  const actual = Buffer.from(token, 'utf8');

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function run(req) {
  return withApi(req, async () => {
    if (!isAuthorized(req)) throw new ApiError(401, 'Unauthorized');
    const result = await processEscrowMaintenance({ limit: 20 });
    return { success: true, ...result };
  }, { skipCsrf: true });
}

export async function GET(req) {
  return run(req);
}

export async function POST(req) {
  return run(req);
}
