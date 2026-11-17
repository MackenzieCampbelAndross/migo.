import { readJson, withApi } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { refundEscrow } from '@/lib/escrow-service';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { escrowRefundSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'escrow:refund', {
      userLimit: 5,
      ipLimit: 10,
      windowSeconds: 60,
      failClosed: true,
    });

    const body = await readJson(req, escrowRefundSchema, 4 * 1024);
    const result = await refundEscrow({ escrowId: body.escrowId, userId: user.id });

    return { success: true, ...result };
  });
}
