'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

function LoginInner() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [supabase, setSupabase] = useState(null);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    try {
      const client = createSupabaseBrowserClient();
      setSupabase(client);
      client.auth.getUser().then(({ data }) => {
        if (data?.user) router.replace('/');
      }).catch(() => {});
    } catch {
      setConfigError(true);
    }
  }, [router]);

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const sendCode = async (event) => {
    event.preventDefault();
    if (!supabase || working || cooldown) return;

    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      setError('Enter a valid email address');
      return;
    }

    setWorking(true);
    setError('');

    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: clean,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
        },
      });

      if (authError) {
        setError('Unable to send a sign-in code. Please try again.');
        return;
      }

      setSentEmail(clean);
      setSent(true);
      setToken('');
      setCooldown(60);
    } catch {
      setError('Unable to send a sign-in code. Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    if (!supabase || verifying || token.length < 6) return;

    setVerifying(true);
    setError('');

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: sentEmail,
        token,
        type: 'email',
      });

      if (verifyError) {
        setError('Invalid or expired code. Try again.');
        return;
      }

      router.replace('/');
    } catch {
      setError('Unable to verify the code. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#F8F8FA] flex flex-col">
      <div className="text-center pt-16 pb-6 relative z-10">
        <h1 className="text-4xl font-extrabold text-[#1C1C1E] tracking-tight">Migo.</h1>
        <p className="text-[#8E8E93] text-sm mt-1 font-medium">Send money anywhere. Instantly.</p>
      </div>

      <div className="flex-1 px-5 pb-10 relative z-10">
        <div className="bg-[#FFFFFF] border border-[#E5E5EA] rounded-[28px] p-6 shadow-sm max-w-md mx-auto">
          {configError ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-[#1C1C1E]">Authentication is not configured</p>
              <p className="text-xs text-[#8E8E93] leading-relaxed">
                Add NEXT_PUBLIC_SUPABASE_ANON_KEY to the environment, then restart the app.
              </p>
            </div>
          ) : sent ? (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-[#F2F2F7] border border-[#E5E5EA] flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-[#1C1C1E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-[#1C1C1E]">Check your email</p>
                <p className="text-xs text-[#8E8E93] mt-2 leading-relaxed">
                  We sent a sign-in email to <span className="font-semibold text-[#1C1C1E]">{sentEmail}</span>.
                  If it includes a verification code, enter it below.
                </p>
              </div>

              <form onSubmit={verifyCode} className="space-y-3">
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 10))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter code"
                  maxLength={10}
                  className="w-full px-4 py-3.5 rounded-2xl text-center font-mono text-2xl font-bold tracking-[0.35em] input-field"
                />
                {error && <p className="text-xs text-[#1C1C1E] font-semibold">{error}</p>}
                <button
                  type="submit"
                  disabled={verifying || token.length < 6}
                  className="w-full py-4 bg-[#000000] text-white rounded-2xl font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  {verifying ? 'Verifying...' : 'Verify code'}
                </button>
              </form>

              <button
                onClick={sendCode}
                disabled={cooldown > 0 || working}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold bg-[#F2F2F7] border border-[#E5E5EA] text-[#1C1C1E] disabled:opacity-40"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
              </button>
              <button
                onClick={() => { setSent(false); setCooldown(0); setToken(''); setError(''); }}
                className="w-full text-xs text-[#8E8E93] font-medium"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label className="text-xs text-[#8E8E93] mb-1.5 block uppercase tracking-wider font-semibold">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="input-field w-full px-4 py-3.5 rounded-2xl text-sm"
                />
              </div>
              {error && <p className="text-xs text-[#1C1C1E] font-semibold">{error}</p>}
              <button
                type="submit"
                disabled={working || !email}
                className="w-full py-4 bg-[#000000] text-white rounded-2xl font-semibold disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                {working ? 'Sending link...' : 'Email me a sign-in link'}
              </button>
              <p className="text-[11px] text-[#8E8E93] text-center leading-relaxed">
                Testnet demo only. No real money is involved.
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-[11px] text-[#8E8E93] mt-6 font-medium">
          <a href="/" className="underline">Back to home</a>
        </p>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-[#F8F8FA]"><div className="w-10 h-10 border-3 border-[#E5E5EA] border-t-[#000000] rounded-full animate-spin" /></div>}>
      <LoginInner />
    </Suspense>
  );
}
