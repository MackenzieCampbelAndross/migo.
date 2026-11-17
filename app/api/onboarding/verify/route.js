import { z } from 'zod';
import { ApiError, readJson, withApi } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createEnrollmentGrant } from '@/lib/onboarding';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { hashDeviceCredential } from '@/lib/security/device-pin';

const schema = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), token: z.string().regex(/^\d{6}$/) }).strict();

export async function POST(req) {
  return withApi(req, async () => {
    const { email, token } = await readJson(req, schema, 2048);
    await enforceRateLimit({ key: `otp:email:${hashDeviceCredential(email)}`, limit: 10, windowSeconds: 900, failClosed: true });
    await enforceRateLimit({ key: `otp:ip:${getClientIp(req)}`, limit: 30, windowSeconds: 900, failClosed: true });
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data?.user || !data?.session) throw new ApiError(400, 'Invalid or expired code. Please try again.');
    const sessionId = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString()).session_id;
    if (!sessionId) throw new ApiError(401, 'Unable to verify this session');
    await createEnrollmentGrant(data.user.id, sessionId);
    return { success: true };
  });
}
