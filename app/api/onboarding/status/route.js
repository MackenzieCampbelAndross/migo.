import { cookies } from 'next/headers';
import { withApi } from '@/lib/api';
import { getAuthUser, getWalletByUserId } from '@/lib/auth';
import { DEVICE_COOKIE, getDevice, getOnboardingDetails, hasEnrollmentGrant, isDeviceUnlocked } from '@/lib/onboarding';

export async function GET(req) {
  return withApi(req, async () => {
    const user = await getAuthUser();
    const recognized = Boolean((await cookies()).get(DEVICE_COOKIE)?.value);
    if (!user) return { success: true, authenticated: false, recognized, step: recognized ? 'email' : 'intro' };
    const device = await getDevice(user.id);
    if (device && await isDeviceUnlocked(user.id, device)) return { success: true, authenticated: true, step: 'dashboard' };
    const freshEmail = await hasEnrollmentGrant(user.id);
    if (device && !freshEmail) return { success: true, authenticated: true, recognized: true, step: 'pin' };
    if (!freshEmail) return { success: true, authenticated: true, recognized, step: 'email', requiresVerification: true };
    const details = await getOnboardingDetails(user.id);
    if (!details) return { success: true, authenticated: true, step: 'phone' };
    const wallet = await getWalletByUserId(user.id);
    return { success: true, authenticated: true, step: wallet ? 'set-pin' : 'wallet' };
  });
}
