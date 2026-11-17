import { ApiError, readQuery, withApi } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { enforceUserAndIpRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { usernameQuerySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();

    await enforceUserAndIpRateLimit(req, user.id, 'user:lookup', {
      userLimit: 30,
      ipLimit: 60,
      windowSeconds: 60,
      failClosed: true,
    });

    const query = readQuery(new URL(req.url).searchParams, usernameQuerySchema);
    const admin = createAdminClient();

    const { data: profile, error } = await admin
      .from('profiles')
      .select('id, username, display_name, base_currency')
      .eq('username', query.username)
      .maybeSingle();

    if (error) {
      throw new ApiError(500, 'Unable to look up user');
    }
    if (!profile) throw new ApiError(404, 'Recipient not found');

    const { data: wallet } = await admin
      .from('wallets')
      .select('address')
      .eq('user_id', profile.id)
      .maybeSingle();

    if (!wallet) throw new ApiError(404, 'Recipient not found');

    return {
      success: true,
      user: {
        address: wallet.address,
        username: profile.username,
        displayName: profile.display_name,
        baseCurrency: profile.base_currency,
      },
    };
  });
}
