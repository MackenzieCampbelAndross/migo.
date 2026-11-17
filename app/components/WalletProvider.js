'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if (response.status === 401) {
        setUser(null);
        setProfile(null);
        setWallet(null);
        return;
      }

      if (response.status === 503) {
        setAuthError(true);
        setUser(null);
        setProfile(null);
        setWallet(null);
        return;
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        setUser(null);
        setProfile(null);
        setWallet(null);
        return;
      }

      setUser(data.user || null);
      setProfile(data.profile || null);
      setWallet(
        data.wallet
          ? {
              address: data.wallet.address,
              username: data.profile?.username || null,
              displayName: data.profile?.displayName || '',
              baseCurrency: data.profile?.baseCurrency || 'USD',
            }
          : null
      );
    } catch {
      setUser(null);
      setProfile(null);
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let subscription = null;

    try {
      const supabase = createSupabaseBrowserClient();
      load();

      const listener = supabase.auth.onAuthStateChange((event) => {
        if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) load();
      });
      subscription = listener.data.subscription;
    } catch {
      setAuthError(true);
      setLoading(false);
    }

    return () => {
      subscription?.unsubscribe();
    };
  }, [load]);

  const logout = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // Local state is cleared below regardless.
    }

    setUser(null);
    setProfile(null);
    setWallet(null);
    window.location.assign('/login');
  };

  return (
    <WalletContext.Provider
      value={{
        user,
        profile,
        wallet,
        loading,
        authError,
        refreshUser: load,
        logout,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within WalletProvider');
  return context;
}
