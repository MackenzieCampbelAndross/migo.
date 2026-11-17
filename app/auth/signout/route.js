import { NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Request blocked' }, { status: 403 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // The client-side sign-out still clears local session state.
  }

  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
