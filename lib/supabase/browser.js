'use client';
import { createBrowserClient } from '@supabase/ssr';

let browserClient = null;

export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Supabase Auth is not configured');
  }

  browserClient = createBrowserClient(url, anonKey, {
    auth: { flowType: 'pkce' },
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  });

  return browserClient;
}
