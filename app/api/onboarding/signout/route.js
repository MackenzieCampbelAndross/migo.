import { ApiError, withApi } from '@/lib/api';
import { clearEnrollment } from '@/lib/onboarding';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(req) {
  return withApi(req, async () => {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error && error.status !== 401 && error.status !== 403) throw new ApiError(503, 'Unable to sign out. Please try again.');
    await clearEnrollment();
    return { success: true };
  });
}
