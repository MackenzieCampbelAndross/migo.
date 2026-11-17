import { z } from 'zod';
import { ApiError, readJson, withApi } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getDevice, makeUnlockGrant, UNLOCK_LIFETIME } from '@/lib/onboarding';
import { verifyPin } from '@/lib/security/device-pin';
import { enforceRateLimit, enforceUserAndIpRateLimit } from '@/lib/rate-limit';

const schema = z.object({ pin: z.string().regex(/^\d{4}$/) }).strict();

export async function POST(req) {
  return withApi(req, async () => {
    const user = await requireUser({ allowLocked: true });
    await enforceUserAndIpRateLimit(req, user.id, 'pin:unlock', { userLimit: 5, ipLimit: 20, windowSeconds: 900 });
    await enforceRateLimit({ key: `user:${user.id}:pin:daily`, limit: 30, windowSeconds: 86400, failClosed: true });
    const { pin } = await readJson(req, schema, 1024);
    const device = await getDevice(user.id);
    if (!device) throw new ApiError(403, 'Verify your email to set up this device');
    if (!await verifyPin(pin, device.pin_hash)) throw new ApiError(400, 'Incorrect PIN. Please try again.');
    return { success: true, unlockToken: await makeUnlockGrant(user.id, device), expiresIn: UNLOCK_LIFETIME };
  });
}
