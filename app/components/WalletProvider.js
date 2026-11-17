'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { apiFetch, clearUnlockToken, getUnlockToken } from '@/lib/client-api';

const WalletContext = createContext(null);
const protectedPaths = ['/dashboard', '/send', '/scan', '/request', '/history', '/split', '/send-code', '/claim'];

export function WalletProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestNumber = useRef(0);
  const identity = useRef(null);
  const pathname = usePathname();
  const router = useRouter();
  const isProtected = protectedPaths.some(path => pathname === path || pathname.startsWith(`${path}/`));

  const lock = useCallback(() => {
    requestNumber.current += 1;
    identity.current = null;
    clearUnlockToken();
    setUser(null);
    setProfile(null);
    setWallet(null);
    setLoading(false);
    setLoadError('');
  }, []);

  const load = useCallback(async () => {
    const token = getUnlockToken();
    const requestId = ++requestNumber.current;
    if (!token) {
      setUser(null);
      setProfile(null);
      setWallet(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    setUser(null);
    setProfile(null);
    setWallet(null);
    try {
      const response = await fetch('/api/me', {
        credentials: 'same-origin', cache: 'no-store', headers: { 'X-Migo-Unlock': token },
      });
      if (requestId !== requestNumber.current || token !== getUnlockToken()) return;
      if (response.status === 401 || response.status === 423) {
        lock();
        return;
      }
      const data = await response.json();
      if (requestId !== requestNumber.current || token !== getUnlockToken()) return;
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load your wallet');
      setAuthError(false);
      identity.current = data.user.id;
      setUser(data.user);
      setProfile(data.profile);
      setWallet(data.wallet ? {
        address: data.wallet.address,
        username: data.profile?.username || null,
        displayName: data.profile?.displayName || '',
        baseCurrency: data.profile?.baseCurrency || 'USD',
      } : null);
    } catch {
      if (requestId === requestNumber.current) setLoadError('Unable to load your account. Check your connection and try again.');
    } finally {
      if (requestId === requestNumber.current) setLoading(false);
    }
  }, [lock]);

  useEffect(() => {
    let subscription;
    try {
      const supabase = createSupabaseBrowserClient();
      load();
      subscription = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || (identity.current && identity.current !== session?.user?.id)) lock();
        else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') load();
      }).data.subscription;
    } catch {
      setAuthError(true);
      setLoading(false);
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && getUnlockToken()) lock();
    };
    window.addEventListener('migo:locked', lock);
    window.addEventListener('pagehide', lock);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      subscription?.unsubscribe();
      window.removeEventListener('migo:locked', lock);
      window.removeEventListener('pagehide', lock);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, lock]);

  useEffect(() => {
    if (isProtected && !loading && !loadError && !wallet) router.replace('/login');
  }, [isProtected, loading, loadError, wallet, router]);

  const logout = async () => {
    lock();
    await apiFetch('/api/onboarding/signout', { method: 'POST' });
    await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
    window.location.assign('/login');
  };

  const blocked = isProtected && (loading || loadError || !wallet || !getUnlockToken());
  return (
    <WalletContext.Provider value={{ user, profile, wallet, loading, authError, refreshUser: load, logout, lock }}>
      {blocked ? (
        <div className="fixed inset-0 bg-[#F5F5F5] text-[#0F172A] flex flex-col items-center justify-center gap-4 px-6 text-center">
          {loadError ? <><p role="alert">{loadError}</p><button className="rounded-2xl bg-black text-white px-6 py-3" onClick={load}>Try again</button><button onClick={lock}>Back to PIN</button></> : <p role="status">Opening Migo…</p>}
        </div>
      ) : children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within WalletProvider');
  return context;
}
