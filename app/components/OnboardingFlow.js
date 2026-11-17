'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import { apiFetch, setUnlockToken } from '@/lib/client-api';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useWallet } from './WalletProvider';
import styles from './OnboardingFlow.module.css';

const ASSETS = '/onboarding/';
const STEPS = new Set(['intro', 'email', 'phone', 'wallet', 'set-pin', 'pin', 'dashboard']);
const COUNTRIES = [
  ['1', 'United States / Canada'], ['44', 'United Kingdom'], ['91', 'India'],
  ['234', 'Nigeria'], ['33', 'France'], ['49', 'Germany'], ['61', 'Australia'],
  ['81', 'Japan'], ['65', 'Singapore'], ['971', 'United Arab Emirates'], ['27', 'South Africa'],
];
const CURRENCIES = [['USD', 'US Dollar'], ['INR', 'Indian Rupee'], ['EUR', 'Euro'], ['NGN', 'Nigerian Naira']];
const digits = (value, length) => value.replace(/\D/g, '').slice(0, length);
const isPinStep = (value) => ['set-pin', 'confirm-pin', 'pin'].includes(value);
const FLOW = ['intro', 'email', 'otp', 'phone', 'wallet', 'set-pin', 'confirm-pin', 'pin'];
const FORM_STEPS = new Set(['email', 'otp', 'phone', 'wallet']);
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const flowKind = (from, next) => {
  if (!FLOW.includes(from) || !FLOW.includes(next)) return 'fade';
  if (from === 'intro' && next === 'email') return 'drop';
  if (from === 'email' && next === 'intro') return 'lift';
  const direction = FLOW.indexOf(next) < FLOW.indexOf(from) ? 'back' : 'forward';
  return FORM_STEPS.has(from) && FORM_STEPS.has(next) ? `content-${direction}` : direction;
};

function Asset({ name, width, height, ...props }) {
  // These local SVGs include the original Figma glyphs and embedded raster icons.
  return <img src={`${ASSETS}${name}.svg`} width={width} height={height} alt="" draggable="false" {...props} />;
}

async function post(url, body) {
  const result = await apiFetch(url, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!result?.success) throw new Error('Request could not be completed. Please try again.');
  return result;
}

export default function OnboardingFlow({ entry = 'intro' }) {
  const router = useRouter();
  const { refreshUser, logout } = useWallet();
  const [step, setRenderedStep] = useState('loading');
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [introReady, setIntroReady] = useState(false);
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [token, setToken] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [country, setCountry] = useState('1');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [pinLength, setPinLength] = useState(0);
  const [viewport, setViewport] = useState(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const pin = useRef('');
  const firstPin = useRef('');
  const heading = useRef(null);
  const otpInput = useRef(null);
  const pinInput = useRef(null);
  const statusRequest = useRef(null);
  const stepRef = useRef('loading');

  const setStep = useCallback((next, update) => {
    const apply = () => {
      update?.();
      stepRef.current = next;
      setRenderedStep(next);
    };
    const from = stepRef.current;
    if (from === next || typeof document.startViewTransition !== 'function'
      || document.visibilityState === 'hidden' || prefersReducedMotion()) {
      apply();
      return;
    }
    const root = document.documentElement;
    root.dataset.flow = flowKind(from, next);
    stepRef.current = next;
    const transition = document.startViewTransition(() => flushSync(apply));
    transition.finished.finally(() => { if (stepRef.current === next) delete root.dataset.flow; });
  }, []);

  const clearPin = useCallback(() => {
    pin.current = '';
    firstPin.current = '';
    if (mounted.current) setPinLength(0);
  }, []);

  const changeStep = useCallback((next) => {
    setStep(next, () => {
      clearPin();
      setToken('');
      setError('');
      setNotice('');
    });
  }, [clearPin, setStep]);

  const goToDashboard = useCallback(async () => {
    if (!prefersReducedMotion()) {
      setLeaving(true);
      await new Promise((resolve) => { window.setTimeout(resolve, 280); });
    }
    if (mounted.current) router.replace('/dashboard');
  }, [router]);

  const applyStatus = useCallback((data) => {
    if (!data?.success || !STEPS.has(data.step)) throw new Error('Unable to check your account. Please retry.');
    if (!mounted.current) return;
    if (data.step === 'dashboard') {
      goToDashboard();
      return;
    }
    changeStep(data.step === 'intro' && entry === 'email' ? 'email' : data.step);
  }, [changeStep, entry, router]);

  const loadStatus = useCallback(async () => {
    // Deduplicate React Strict Mode's mount effects; this is not a polling loop.
    if (!statusRequest.current) {
      statusRequest.current = apiFetch('/api/onboarding/status').finally(() => { statusRequest.current = null; });
    }
    const data = await statusRequest.current;
    applyStatus(data);
  }, [applyStatus]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    loadStatus().catch(() => {
      if (active) {
        setStep('status-error');
        setError('We couldn’t check your account. Check your connection and try again.');
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      pin.current = '';
      firstPin.current = '';
    };
  }, [loadStatus]);

  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return undefined;
    const resize = () => setViewport({ height: visual.height, top: visual.offsetTop });
    resize();
    visual.addEventListener('resize', resize);
    visual.addEventListener('scroll', resize);
    return () => {
      visual.removeEventListener('resize', resize);
      visual.removeEventListener('scroll', resize);
    };
  }, []);

  useEffect(() => {
    if (step !== 'intro') return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIntroReady(reduced.matches);
    const timer = window.setTimeout(() => setIntroReady(true), reduced.matches ? 0 : 5000);
    const onMotionChange = () => { if (reduced.matches) setIntroReady(true); };
    reduced.addEventListener('change', onMotionChange);
    return () => { clearTimeout(timer); reduced.removeEventListener('change', onMotionChange); };
  }, [step]);

  useEffect(() => {
    if (!resendAt) return undefined;
    const tick = () => setCooldown(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const hidePin = () => {
      if (document.visibilityState === 'hidden' && isPinStep(step)) {
        clearPin();
        if (step === 'confirm-pin') setStep('set-pin');
      }
    };
    document.addEventListener('visibilitychange', hidePin);
    return () => document.removeEventListener('visibilitychange', hidePin);
  }, [step, clearPin]);

  const run = async (action, fallback) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (mounted.current) {
        setError(cause?.status === 429
          ? `Too many attempts. Please try again in ${Math.ceil((cause.retryAfter || 900) / 60)} minutes.`
          : (cause?.status ? cause.message : fallback) || 'Something went wrong. Please try again.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const resume = async () => {
    try {
      await loadStatus();
    } catch {
      if (mounted.current) setStep('status-error');
      throw new Error('Could not load the next step.');
    }
  };

  const sendCode = (event, resend = false) => {
    event?.preventDefault();
    if (Date.now() < resendAt || pending.current) return;
    const cleanEmail = (resend ? sentEmail : email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    run(async () => {
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithOtp({
        email: cleanEmail, options: { shouldCreateUser: true },
      });
      if (authError) throw authError;
      if (!mounted.current) return;
      setSentEmail(cleanEmail);
      setEmail(cleanEmail);
      setCooldown(60);
      setResendAt(Date.now() + 60000);
      changeStep('otp');
      if (resend) setNotice('A new verification code has been sent.');
    }, 'Unable to send a verification code. Please try again.');
  };

  const verifyCode = (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(token)) { setError('Enter the full 6-digit code from your email.'); return; }
    run(async () => {
      const code = token;
      setToken('');
      await post('/api/onboarding/verify', { email: sentEmail, token: code });
      await resume();
    }, 'Unable to verify your code or continue. Check the code and try again.');
  };

  const savePhone = (event) => {
    event.preventDefault();
    const international = `+${country}${phone.replace(/\D/g, '')}`;
    if (!/^\+[1-9]\d{7,14}$/.test(international)) {
      setError('Enter a valid mobile number without the country code or leading local zero.');
      return;
    }
    run(async () => {
      await post('/api/onboarding/phone', { phone: international });
      await resume();
    }, 'Unable to save your mobile number or continue. Check the number and try again.');
  };

  const createWallet = (event) => {
    event.preventDefault();
    if (!displayName.trim() || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      setError('Enter your name and a username of 3–20 letters, numbers or underscores.');
      return;
    }
    run(async () => {
      try {
        await post('/api/wallet', { displayName: displayName.trim(), username, baseCurrency });
      } catch (cause) {
        if (cause.status === 409) {
          const status = await apiFetch('/api/onboarding/status');
          if (status.step === 'set-pin') { applyStatus(status); return; }
        }
        throw cause;
      }
      await resume();
    }, 'Unable to create your wallet or continue. Please check your connection and try again.');
  };

  const submitPin = () => {
    if (pending.current) return;
    if (pin.current.length !== 4) { setError('Enter all 4 digits to continue.'); return; }
    if (step === 'set-pin') {
      firstPin.current = pin.current;
      pin.current = '';
      setPinLength(0);
      setError('');
      setStep('confirm-pin');
      return;
    }
    if (step === 'confirm-pin' && firstPin.current !== pin.current) {
      clearPin();
      setStep('set-pin');
      setError('Your PINs didn’t match. Please create your PIN again.');
      return;
    }
    const enrollment = step === 'confirm-pin';
    const payload = enrollment ? { pin: firstPin.current, confirmation: pin.current } : { pin: pin.current };
    clearPin();
    run(async () => {
      let result;
      try {
        result = await post(enrollment ? '/api/onboarding/pin' : '/api/onboarding/unlock', payload);
      } catch (cause) {
        if (mounted.current && enrollment) setStep('set-pin');
        throw cause;
      } finally {
        payload.pin = '';
        if (enrollment) payload.confirmation = '';
      }
      if (!mounted.current) return;
      if (!result.unlockToken || !Number.isFinite(result.expiresIn) || result.expiresIn <= 0) {
        setStep('status-error');
        throw new Error('Unable to unlock your account.');
      }
      if (document.visibilityState === 'hidden') {
        changeStep('pin');
        return;
      }
      setUnlockToken(result.unlockToken, result.expiresIn);
      if (enrollment) post('/api/wallet/setup').catch(() => {});
      try {
        await refreshUser();
      } catch {
        if (mounted.current) setStep('status-error');
        throw new Error('Unable to refresh your account.');
      }
      if (mounted.current) await goToDashboard();
    }, enrollment ? 'Unable to save your PIN. Please try again.' : 'Unable to unlock. Check your PIN and try again.');
  };

  const editPin = (key) => {
    if (pending.current) return;
    setError('');
    if (key === 'backspace') pin.current = pin.current.slice(0, -1);
    else if (/^\d$/.test(key)) pin.current = (pin.current + key).slice(0, 4);
    setPinLength(pin.current.length);
  };

  const pastePin = (event) => {
    event.preventDefault();
    if (pending.current) return;
    const value = event.clipboardData.getData('text').trim();
    if (!/^\d{4}$/.test(value)) { setError('Paste a 4-digit PIN.'); return; }
    pin.current = value;
    setPinLength(4);
    setError('');
  };

  const pinKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('[data-pin-link]')) return;
    if (/^\d$/.test(event.key)) { event.preventDefault(); editPin(event.key); }
    else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); editPin('backspace'); }
    else if (event.key === 'Enter') { event.preventDefault(); submitPin(); }
  };

  const back = () => {
    if (pending.current) return;
    if (step === 'confirm-pin') changeStep('set-pin');
    else if (step === 'email' && entry === 'intro') changeStep('intro');
    else changeStep('email');
  };

  const recoverPin = () => {
    changeStep('email');
    setNotice('Verify your email to securely reset your app PIN.');
  };

  const anotherAccount = () => run(async () => {
    clearPin();
    setEmail('');
    setSentEmail('');
    setToken('');
    setPhone('');
    setDisplayName('');
    setUsername('');
    await logout();
    if (mounted.current) changeStep('email');
  }, 'Unable to sign out. Please try again.');

  const feedback = (
    <div className={styles.feedback} aria-live="polite" aria-atomic="true">
      {error ? <p id="onboarding-feedback" role="alert" className={styles.error}>{error}</p>
        : notice ? <p id="onboarding-feedback">{notice}</p> : null}
    </div>
  );
  const continueButton = (label = 'Continue', disabled = false) => (
    <button type="submit" className={styles.primaryButton} disabled={busy || disabled}>
      {busy ? 'Please wait…' : label}
      {!busy && label === 'Continue' && <Asset name="arrow-right" width={24} height={24} />}
    </button>
  );
  const fieldProps = { disabled: busy, 'aria-invalid': Boolean(error), 'aria-describedby': error || notice ? 'onboarding-feedback' : undefined };
  const pinScreen = isPinStep(step);

  return (
    <div
      className={`${styles.root} ${step === 'intro' ? styles.introRoot : ''} ${pinScreen ? styles.pinRoot : ''} ${leaving ? styles.leaving : ''}`}
      style={viewport ? { height: `${viewport.height}px`, top: `${viewport.top}px` } : undefined}
    >
      <section className={styles.stage} aria-label="Migo onboarding" aria-busy={busy || step === 'loading'}>
        {step === 'loading' || step === 'status-error' ? (
          <div className={styles.loadingPanel}>
            <Asset name="logo-migo-dark" width={104} height={52} />
            <h1 ref={heading} tabIndex={-1}>{step === 'loading' ? 'Getting Migo ready…' : 'Let’s try again'}</h1>
            {step === 'status-error' && <>
              {feedback}
              <button className={styles.primaryButton} disabled={busy} onClick={() => run(resume, 'We couldn’t check your account. Please try again.')}>{busy ? 'Checking…' : 'Retry'}</button>
            </>}
          </div>
        ) : step === 'intro' ? (
          <div className={styles.intro}>
            <h1 className={styles.srOnly}>Migo. Borderless payments. Made simple.</h1>
            <div className={styles.introWord} aria-hidden="true"><Asset name="logo-migo" width={246} height={125} className={styles.introWordImage} /></div>
            <Asset name="tagline" width={266} height={18} className={styles.tagline} />
            <button className={styles.getStarted} disabled={!introReady} onClick={() => changeStep('email')}>Get started</button>
            <p className={styles.footer}>XRPL Testnet · No real money</p>
          </div>
        ) : pinScreen ? (
          <div className={`${styles.pinScreen} ${step === 'pin' ? styles.returningPin : ''}`} onKeyDown={pinKeyDown} onPaste={pastePin}>
            <div className={styles.pinHeader}>
              {step !== 'pin' && <button type="button" data-pin-link className={styles.pinBack} onClick={back} disabled={busy} aria-label={step === 'confirm-pin' ? 'Choose a new PIN' : 'Back to email'}><Asset name="arrow-right" width={24} height={24} /></button>}
              <h1 ref={heading} tabIndex={-1} className={styles.pinTitle}>{step === 'pin' ? 'Enter Your App PIN' : 'Set Your App PIN'}</h1>
              {step !== 'pin' && <p className={styles.pinSubtitle}>{step === 'confirm-pin' ? 'Confirm PIN' : 'Create a 4 digit app PIN.'}</p>}
              <div className={styles.pinEntry}>
                <label className={styles.srOnly} htmlFor="app-pin">{step === 'confirm-pin' ? 'Confirm your 4-digit PIN' : 'Your 4-digit app PIN'}</label>
                <input id="app-pin" ref={pinInput} className={styles.pinInput} type="password" inputMode="none" autoComplete="off" value="" disabled={busy}
                  onChange={(event) => {
                    if (pending.current) return;
                    pin.current = (pin.current + digits(event.target.value, 4)).slice(0, 4);
                    setPinLength(pin.current.length);
                  }} aria-describedby="pin-count" aria-invalid={Boolean(error)} />
                <div className={styles.pinDots} aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <span key={i} className={i < pinLength ? styles.filledDot : ''} />)}</div>
                <span className={styles.srOnly} id="pin-count" role="status">{pinLength} of 4 digits entered</span>
              </div>
              <div className={styles.pinFeedback}>{busy ? <p role="status">Unlocking securely…</p> : feedback}</div>
              {step === 'pin' && <div className={styles.pinLinks}>
                <button data-pin-link onClick={recoverPin} disabled={busy}>Forgot PIN?</button>
                <button data-pin-link onClick={anotherAccount} disabled={busy}>Use another account</button>
              </div>}
            </div>
            <div className={styles.keypad} role="group" aria-label="PIN keypad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'backspace', 0, 'submit'].map((key) => (
                <button key={key} type="button" disabled={busy || (key === 'submit' && pinLength !== 4)}
                  aria-label={key === 'backspace' ? 'Delete last digit' : key === 'submit' ? step === 'set-pin' ? 'Continue to confirm PIN' : 'Confirm PIN and unlock' : String(key)}
                  onClick={() => key === 'submit' ? submitPin() : editPin(String(key))}>
                  {key === 'backspace' ? <Asset name="backspace" width={33} height={33} /> : key === 'submit' ? <Asset name="check" width={29} height={29} /> : key}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div data-flow-panel className={styles.formPanel}>
              <header className={styles.header}>
                {(step !== 'email' || entry === 'intro') && <button type="button" className={styles.backButton} onClick={back} disabled={busy} aria-label={step === 'otp' ? 'Change email address' : 'Go back'}><Asset name="arrow-right" width={24} height={24} /></button>}
                <Asset name="logo-migo-dark" width={52} height={26} />
              </header>
              {step === 'email' && <form data-flow-content className={`${styles.formContent} ${styles.emailForm}`} onSubmit={sendCode}>
                <h1 className={styles.title} tabIndex={-1} ref={heading}>Enter<br />Mail Address</h1>
                <p className={styles.description}>We’ll send you a verification code to continue.</p>
                <label className={styles.srOnly} htmlFor="onboarding-email">Email address</label>
                <input {...fieldProps} id="onboarding-email" className={styles.textInput} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="xyz@gmail.com" value={email} onChange={(event) => setEmail(event.target.value)} />
                {continueButton(cooldown > 0 ? `Send code in ${cooldown}s` : 'Continue', cooldown > 0)}
                {feedback}
              </form>}
              {step === 'otp' && <form data-flow-content className={`${styles.formContent} ${styles.otpForm}`} onSubmit={verifyCode}>
                <h1 className={styles.title} tabIndex={-1} ref={heading}>Verify OTP</h1>
                <p className={styles.description}>Enter the 6-digit code sent to your email address.</p>
                <div className={styles.otpEntry}>
                  <label className={styles.srOnly} htmlFor="email-code">6-digit verification code sent to {sentEmail}</label>
                  <input {...fieldProps} id="email-code" ref={otpInput} className={styles.otpInput} value={token} onChange={(event) => setToken(digits(event.target.value, 6))} onPaste={(event) => { event.preventDefault(); setToken(digits(event.clipboardData.getData('text'), 6)); }} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} />
                  <div className={styles.otpBoxes} aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} className={i === Math.min(token.length, 5) ? styles.activeOtp : ''}>{token[i] || ''}</span>)}</div>
                </div>
                {continueButton('Verify Account', token.length !== 6)}
                <button className={styles.resend} type="button" disabled={busy || cooldown > 0} onClick={(event) => sendCode(event, true)}>{cooldown > 0 ? `Resend OTP in ${String(Math.floor(cooldown / 60)).padStart(2, '0')}:${String(cooldown % 60).padStart(2, '0')}` : 'Resend OTP'}</button>
                {feedback}
              </form>}
              {step === 'phone' && <form data-flow-content className={`${styles.formContent} ${styles.phoneForm}`} onSubmit={savePhone}>
                <h1 className={styles.title} tabIndex={-1} ref={heading}>Enter<br />Mobile Number</h1>
                <div className={styles.phoneEntry}>
                  <label className={styles.srOnly} htmlFor="phone-country">Country calling code</label>
                  <select id="phone-country" className={styles.countrySelect} value={country} onChange={(event) => setCountry(event.target.value)} disabled={busy}>{COUNTRIES.map(([prefix, name]) => <option key={prefix} value={prefix}>+{prefix} — {name}</option>)}</select>
                  <span className={styles.countryDisplay} aria-hidden="true">+{country}<Asset name="arrow-down" width={16} height={16} /></span>
                  <label className={styles.srOnly} htmlFor="mobile-number">Mobile number without country code</label>
                  <input {...fieldProps} id="mobile-number" className={styles.textInput} type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="Mobile number" value={phone} onChange={(event) => setPhone(digits(event.target.value, 14))} />
                </div>
                {continueButton()}
                {feedback}
              </form>}
              {step === 'wallet' && <form data-flow-content className={`${styles.formContent} ${styles.walletForm}`} onSubmit={createWallet}>
                <h1 className={styles.title} tabIndex={-1} ref={heading}>Create<br />Wallet.</h1>
                <div className={styles.nameField}>
                  <label htmlFor="wallet-name">Name.</label>
                  <input {...fieldProps} className={styles.textInput} id="wallet-name" autoComplete="name" required maxLength={50} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </div>
                <div className={styles.usernameField}>
                  <label htmlFor="wallet-username">Username.</label>
                  <input {...fieldProps} className={styles.textInput} id="wallet-username" autoComplete="username" autoCapitalize="none" spellCheck={false} required pattern="[a-zA-Z0-9_]{3,20}" title="3–20 letters, numbers or underscores" minLength={3} maxLength={20} value={username} onChange={(event) => setUsername(event.target.value)} />
                </div>
                <div className={styles.currencyField}>
                  <label htmlFor="wallet-currency">Currency</label>
                  <select id="wallet-currency" disabled={busy} value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}>{CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}</select>
                  <span className={styles.currencyDisplay} aria-hidden="true">{baseCurrency}</span>
                  <Asset name="arrow-down" width={25} height={25} />
                </div>
                {continueButton()}
                {feedback}
              </form>}
            </div>
            <p className={styles.footer}>XRPL Testnet · No real money</p>
          </>
        )}
      </section>
    </div>
  );
}
