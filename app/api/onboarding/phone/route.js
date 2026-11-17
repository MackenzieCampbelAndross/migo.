import { z } from 'zod';
import { ApiError, readJson, withApi } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { requireEnrollment } from '@/lib/onboarding';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';

const schema = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) }).strict();

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser({ allowLocked: true });
    await requireEnrollment(user.id);
    await enforceUserAndIpRateLimit(req, user.id, 'onboarding:phone', { userLimit: 10, ipLimit: 30, windowSeconds: 900 });
    const { phone } = await readJson(req, schema, 1024);
    const { error } = await createAdminClient().from('onboarding_details').upsert({ user_id: user.id, phone, phone_verified: false, updated_at: new Date().toISOString() });
    if (error) throw new ApiError(503, 'Unable to save your mobile number');
    return { success: true };
  });
}
