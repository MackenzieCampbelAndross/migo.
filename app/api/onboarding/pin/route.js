import { z } from 'zod';
import { readJson, withApi } from '@/lib/api';
import { requireUser, requireWallet } from '@/lib/auth';
import { enrollDevice, requireOnboardingPhone, UNLOCK_LIFETIME } from '@/lib/onboarding';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';

const schema = z.object({ pin: z.string().regex(/^\d{4}$/), confirmation: z.string().regex(/^\d{4}$/) }).strict().refine(value => value.pin === value.confirmation);

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser({ allowLocked: true });
    await requireOnboardingPhone(user.id);
    await requireWallet(user.id);
    await enforceUserAndIpRateLimit(req, user.id, 'pin:enroll', { userLimit: 5, ipLimit: 15, windowSeconds: 3600 });
    const { pin } = await readJson(req, schema, 1024);
    return { success: true, unlockToken: await enrollDevice(user.id, pin), expiresIn: UNLOCK_LIFETIME };
  });
}
