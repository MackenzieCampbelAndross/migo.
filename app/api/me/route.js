import { withApi } from '@/lib/api';
import { getProfile, getWalletByUserId, requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  return withApi(req, async () => {
    const user = await requireUser();
    const [profile, wallet] = await Promise.all([
      getProfile(user.id),
      getWalletByUserId(user.id),
    ]);

    return {
      success: true,
      user: { id: user.id },
      profile: profile
        ? {
            username: profile.username,
            displayName: profile.display_name,
            baseCurrency: profile.base_currency,
          }
        : null,
      wallet: wallet ? { address: wallet.address } : null,
    };
  });
}
