// app/components/UnifiedOnboarding.js
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setUnlockToken } from '@/lib/client-api';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import CodeSlots from './reactbits/CodeSlots';
import GlideSelect from './reactbits/GlideSelect';

const COUNTRIES = [
  { code: '+1', label: 'US / CA (+1)' },
  { code: '+91', label: 'India (+91)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+234', label: 'Nigeria (+234)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+81', label: 'Japan (+81)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+971', label: 'UAE (+971)' },
];

const CURRENCIES = ['USD', 'INR', 'EUR', 'NGN'];

export default function UnifiedOnboarding() {
  const router = useRouter();

  // Form fields
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [pin, setPin] = useState('');

  // Status state
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');

  // CodeSlots status states: 'idle' | 'error' | 'success'
  const [otpSlotStatus, setOtpSlotStatus] = useState('idle');
  const [pinSlotStatus, setPinSlotStatus] = useState('idle');

  // Countdown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Send Email OTP
  const handleSendOtp = async () => {
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setBusy(true);
    setStatusMessage('Sending verification code...');
    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true },
      });
      if (authError) throw authError;

      setOtpSent(true);
      setCooldown(60);
      setStatusMessage(`Verification code sent to ${cleanEmail}`);
    } catch (err) {
      setError(err.message || 'Unable to send code. Please try again.');
      setStatusMessage('');
    } finally {
      setBusy(false);
    }
  };

  // Submit complete registration and create wallet
  const handleCreateWallet = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setError('');
    setStatusMessage('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = token.trim();
    const cleanPhoneDigits = phone.replace(/\D/g, '');
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    const cleanPin = pin.trim();

    if (!cleanEmail) {
      setError('Please enter your email.');
      return;
    }
    if (!cleanToken || cleanToken.length !== 6) {
      setError('Please enter the 6-digit code sent to your email.');
      setOtpSlotStatus('error');
      return;
    }
    if (!cleanPhoneDigits || cleanPhoneDigits.length < 7) {
      setError('Please enter a valid mobile number.');
      return;
    }
    if (!cleanUsername || cleanUsername.length < 3) {
      setError('Please choose a username of at least 3 characters.');
      return;
    }
    if (!/^\d{4}$/.test(cleanPin)) {
      setError('Please choose a 4-digit device PIN.');
      setPinSlotStatus('error');
      return;
    }

    const fullPhone = `${countryCode}${cleanPhoneDigits}`;

    setBusy(true);
    setStatusMessage('Verifying credentials...');

    try {
      // Step 1: Verify OTP and establish session
      await apiFetch('/api/onboarding/verify', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail, token: cleanToken }),
      });
      setOtpSlotStatus('success');

      setStatusMessage('Saving mobile number...');

      // Step 2: Save Phone Number
      await apiFetch('/api/onboarding/phone', {
        method: 'POST',
        body: JSON.stringify({ phone: fullPhone }),
      });

      setStatusMessage('Generating XRPL Testnet wallet...');

      // Step 3: Create Wallet & Profile
      await apiFetch('/api/wallet', {
        method: 'POST',
        body: JSON.stringify({
          username: cleanUsername,
          displayName: cleanUsername,
          baseCurrency: currency,
        }),
      });

      setStatusMessage('Setting device security PIN...');

      // Step 4: Enroll Device PIN
      const pinRes = await apiFetch('/api/onboarding/pin', {
        method: 'POST',
        body: JSON.stringify({ pin: cleanPin, confirmation: cleanPin }),
      });

      setPinSlotStatus('success');

      if (pinRes?.unlockToken) {
        setUnlockToken(pinRes.unlockToken);
      }

      setStatusMessage('Wallet created! Redirecting to dashboard...');
      setTimeout(() => {
        router.push('/dashboard');
      }, 500);

    } catch (err) {
      setError(err.message || 'Registration failed. Please check your details and try again.');
      setStatusMessage('');
      setBusy(false);
      setOtpSlotStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1017] text-white flex flex-col justify-between py-10 px-5">
      
      {/* Top Header */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between pb-6">
        <button
          onClick={() => router.push('/')}
          className="text-xl font-bold font-display tracking-tight text-white flex items-center gap-2"
        >
          <span>migo.</span>
        </button>
        <div className="w-8 h-8 rounded-full border border-[#262E3D] overflow-hidden bg-[#161B26]">
          <img src="/ambassador.png" alt="Ambassador" className="w-full h-full object-cover" />
        </div>
      </header>

      {/* Main Single Card */}
      <main className="max-w-md w-full mx-auto">
        <div className="bg-[#161B26] border border-[#262E3D] rounded-3xl p-6 sm:p-8 shadow-xl">
          
          <h1 className="text-2xl font-bold text-white tracking-tight mb-1">
            Create Your Migo Wallet
          </h1>
          <p className="text-xs text-[#94A3B8] mb-6">
            Enter your email, verification code, and mobile number in one step.
          </p>

          <form onSubmit={handleCreateWallet} className="flex flex-col gap-5">
            
            {/* Field 1: Email Address with Send OTP */}
            <div>
              <label className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider block mb-1.5">
                Email Address
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  disabled={busy}
                  className="flex-1 px-4 py-3 rounded-2xl bg-[#0D1017] border border-[#262E3D] text-white text-sm focus:outline-none focus:border-[#7C3AED] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={busy || cooldown > 0 || !email}
                  className="px-4 py-3 rounded-2xl bg-[#1E2430] hover:bg-[#262E3D] text-white text-xs font-bold disabled:opacity-40 transition-colors shrink-0 border border-[#262E3D]"
                >
                  {cooldown > 0 ? `${cooldown}s` : otpSent ? 'Resend' : 'Send Code'}
                </button>
              </div>
            </div>

            {/* Field 2: 6-Digit Email Code via CodeSlots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">
                  6-Digit Email Code
                </label>
                {otpSent && (
                  <span className="text-[10px] text-[#7C3AED] font-semibold">
                    Code dispatched
                  </span>
                )}
              </div>
              <div className="flex justify-center p-3 rounded-2xl bg-[#0D1017] border border-[#262E3D]">
                <CodeSlots
                  length={6}
                  value={token}
                  onChange={(val) => {
                    setToken(val);
                    if (otpSlotStatus === 'error') setOtpSlotStatus('idle');
                  }}
                  status={otpSlotStatus}
                  disabled={busy}
                  accentColor="#7C3AED"
                  inkColor="#7C3AED"
                  slotColor="#161B26"
                  digitColor="#FFFFFF"
                  dangerColor="#EF4444"
                  slotSize={44}
                  gap={6}
                  radius={12}
                />
              </div>
            </div>

            {/* Field 3: Mobile Phone Number */}
            <div>
              <label className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider block mb-1.5">
                Mobile Number
              </label>
              <div className="flex gap-2 items-center">
                <GlideSelect
                  options={COUNTRIES.map((c) => ({ value: c.code, label: c.code, tag: c.label.replace(` (${c.code})`, '') }))}
                  value={countryCode}
                  onChange={(val) => setCountryCode(val)}
                  disabled={busy}
                  size="md"
                  menuWidth={180}
                  surfaceColor="#0D1017"
                  highlightColor="#1E2430"
                  accentColor="#7C3AED"
                  className="w-28 shrink-0"
                />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="555 123 4567"
                  disabled={busy}
                  className="flex-1 px-4 py-2.5 rounded-2xl bg-[#0D1017] border border-[#262E3D] text-white text-sm focus:outline-none focus:border-[#7C3AED] disabled:opacity-50"
                />
              </div>
            </div>

            {/* Field 4: Username & Base Currency */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider block mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-sm">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="alex"
                    maxLength={20}
                    disabled={busy}
                    className="w-full pl-7 pr-3 py-2.5 rounded-2xl bg-[#0D1017] border border-[#262E3D] text-white text-sm focus:outline-none focus:border-[#7C3AED] disabled:opacity-50 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider block mb-1.5">
                  Currency
                </label>
                <GlideSelect
                  options={[
                    { value: 'USD', label: 'USD', tag: 'United States' },
                    { value: 'INR', label: 'INR', tag: 'India' },
                    { value: 'EUR', label: 'EUR', tag: 'Europe' },
                    { value: 'NGN', label: 'NGN', tag: 'Nigeria' },
                  ]}
                  value={currency}
                  onChange={(val) => setCurrency(val)}
                  disabled={busy}
                  size="md"
                  menuWidth={170}
                  surfaceColor="#0D1017"
                  highlightColor="#1E2430"
                  accentColor="#7C3AED"
                  className="w-full"
                />
              </div>
            </div>

            {/* Field 5: 4-Digit Device PIN via CodeSlots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">
                  4-Digit Device PIN
                </label>
                <span className="text-[10px] text-[#94A3B8]">
                  Protects device unlocks
                </span>
              </div>
              <div className="flex justify-center p-3 rounded-2xl bg-[#0D1017] border border-[#262E3D]">
                <CodeSlots
                  length={4}
                  value={pin}
                  onChange={(val) => {
                    setPin(val);
                    if (pinSlotStatus === 'error') setPinSlotStatus('idle');
                  }}
                  status={pinSlotStatus}
                  mask={true}
                  disabled={busy}
                  accentColor="#7C3AED"
                  inkColor="#7C3AED"
                  slotColor="#161B26"
                  digitColor="#FFFFFF"
                  dangerColor="#EF4444"
                  slotSize={48}
                  gap={10}
                  radius={12}
                />
              </div>
            </div>

            {/* Status message */}
            {statusMessage && (
              <p className="text-xs text-white bg-[#1E2430] border border-[#262E3D] p-3 rounded-xl font-medium">
                {statusMessage}
              </p>
            )}

            {/* Error message */}
            {error && (
              <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 p-3 rounded-xl font-semibold">
                {error}
              </p>
            )}

            {/* Primary Submit Button */}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-4 mt-1 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-bold text-sm tracking-wide active:scale-[0.99] transition-all disabled:opacity-50 shadow-md"
            >
              {busy ? 'Processing...' : 'Create Wallet'}
            </button>
          </form>

        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-md w-full mx-auto text-center pt-6 text-xs text-[#94A3B8]">
        <span>Secured by Migo Sovereign Cryptography</span>
      </footer>

    </div>
  );
}
