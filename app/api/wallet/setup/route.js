import { ApiError, withApi } from '@/lib/api';
import { requireSigningWallet, requireUser } from '@/lib/auth';
import { safeLog } from '@/lib/logger';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { getUserSigner } from '@/lib/signing/server-signer';
import { SUPPORTED_CURRENCIES } from '@/lib/xrpl-config';
import { ensureTrustLine } from '@/lib/xrpl-wallet';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'wallet:setup', {
      userLimit: 3,
      ipLimit: 10,
      windowSeconds: 60 * 60,
      failClosed: true,
    });

    const wallet = await requireSigningWallet(user.id);
    let signer;

    try {
      signer = getUserSigner(user.id, wallet);
    } catch {
      safeLog('error', 'wallet.setup_signer_failed', { userId: user.id });
      throw new ApiError(503, 'Signing is temporarily unavailable');
    }

    const results = {};

    for (const currency of SUPPORTED_CURRENCIES) {
      try {
        await ensureTrustLine(signer.wallet, currency);
        results[currency] = 'ready';
      } catch {
        results[currency] = 'failed';
      }
    }

    return { success: true, results };
  });
}
