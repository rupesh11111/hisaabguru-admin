'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button, ErrorNote } from '@/components/ui';
import { ApiError, authApi, setToken } from '@/lib/api';
import { hasAdminAccess, useSession } from '@/lib/session';

const PHONE_DIGITS = 10;
const OTP_DIGITS = 6;
/** The API allows 5 OTP requests per 15 minutes, so resend is paced, not free. */
const RESEND_AFTER_S = 30;

const HIGHLIGHTS = [
  {
    title: 'Global product catalog',
    text: 'Review, approve and merge the items every shop scans.',
  },
  {
    title: 'Shops and users',
    text: 'Memberships, roles and permissions across every dukaan.',
  },
  {
    title: 'Plans and releases',
    text: 'Subscription limits, referrals and app versions in one place.',
  },
];

const digitsOnly = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

/** Autofill and paste bring "+91 98765 43210" or "098765…": keep the last 10 digits. */
const phoneDigits = (v: string) => {
  const d = v.replace(/\D/g, '');
  return d.length > PHONE_DIGITS ? d.slice(-PHONE_DIGITS) : d;
};

export default function LoginPage() {
  const router = useRouter();
  const { state, refresh } = useSession();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Already signed in with a valid admin session — skip the form entirely.
  useEffect(() => {
    if (state.status === 'authenticated' && hasAdminAccess(state.user)) {
      router.replace('/');
    }
  }, [state, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const phoneValid = phone.length === PHONE_DIGITS;
  const codeValid = code.length === OTP_DIGITS;

  const sendOtp = async () => {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestOtp(phone);
      setDebugCode(res.debugCode ?? null);
      setCode('');
      setStep('code');
      setResendIn(RESEND_AFTER_S);
      // After the step swap renders.
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the OTP');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== OTP_DIGITS || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.verifyOtp(phone, value);
      setToken(res.accessToken);
      await refresh();
      // The session provider re-reads /auth/me; the redirect above takes over once
      // it confirms admin access. A non-admin gets the message below instead.
      const me = await authApi.me();
      if (!hasAdminAccess(me)) {
        setToken(null);
        setError('This number does not have admin access.');
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the OTP');
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setStep('phone');
    setCode('');
    setError(null);
    setDebugCode(null);
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel — desktop only; on phones the form carries a compact header. */}
      <section className="sidebar-brand relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/5"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-[28rem] rounded-full bg-accent/10"
        />

        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static 128px asset; next/image adds nothing here. */}
          <img src="/logo.png" alt="" width={44} height={44} className="size-11 rounded-xl" />
          <span>
            <span className="block text-lg font-extrabold leading-tight">hisaabGuru</span>
            <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">
              Admin console
            </span>
          </span>
        </div>

        <div className="relative my-auto max-w-md py-12">
          <h2 className="text-4xl font-black leading-tight tracking-tight">
            Run the platform behind every dukaan.
          </h2>
          <p className="mt-4 text-base text-white/80">
            One place to keep the catalog clean and the shops, users and plans in order.
          </p>

          <ul className="mt-10 flex flex-col gap-5">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-brand-deep">
                  <CheckIcon />
                </span>
                <span>
                  <span className="block font-semibold">{h.title}</span>
                  <span className="block text-sm text-white/70">{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          © {new Date().getFullYear()} hisaabGuru · Restricted to authorised staff
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- static 128px asset; next/image adds nothing here. */}
            <img src="/logo.png" alt="" width={40} height={40} className="size-10 rounded-xl" />
            <span>
              <span className="block font-extrabold leading-tight text-ink">hisaabGuru</span>
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
                Admin console
              </span>
            </span>
          </div>

          <StepDots step={step} />

          {step === 'phone' ? (
            <>
              <h1 className="mt-4 text-2xl font-black tracking-tight text-ink">Sign in</h1>
              <p className="mt-1 text-sm text-muted">
                Enter the mobile number that has admin access. We&apos;ll send a one-time
                code.
              </p>

              <form
                className="mt-8 flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendOtp();
                }}>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink">Mobile number</span>
                  <span className="flex items-stretch overflow-hidden rounded-lg border border-line bg-surface transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
                    <span className="flex items-center border-r border-line bg-surface-alt px-3 text-sm font-semibold text-muted">
                      +91
                    </span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(phoneDigits(e.target.value))}
                      placeholder="98765 43210"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      autoFocus
                      aria-invalid={Boolean(error)}
                      className="tnum min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base tracking-wide text-ink outline-none placeholder:text-muted/50"
                    />
                  </span>
                </label>

                {error ? <ErrorNote message={error} /> : null}

                <Button
                  type="submit"
                  loading={busy}
                  disabled={!phoneValid}
                  className="py-2.5">
                  Send OTP
                </Button>
              </form>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-2xl font-black tracking-tight text-ink">
                Enter verification code
              </h1>
              <p className="mt-1 text-sm text-muted">
                We sent a {OTP_DIGITS}-digit code to{' '}
                <span className="tnum font-semibold text-ink">
                  +91 {phone.slice(0, 5)} {phone.slice(5)}
                </span>
                .{' '}
                <button
                  type="button"
                  onClick={changeNumber}
                  className="font-semibold text-brand hover:text-brand-deep hover:underline">
                  Change
                </button>
              </p>

              <form
                className="mt-8 flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}>
                <OtpField
                  inputRef={codeRef}
                  value={code}
                  disabled={busy}
                  onChange={(v) => {
                    setCode(v);
                    if (error) setError(null);
                    // A pasted or autofilled code signs in without an extra click.
                    if (v.length === OTP_DIGITS) void verify(v);
                  }}
                />

                {debugCode ? (
                  <p className="rounded-lg border border-accent/40 bg-accent-tint px-3 py-2 text-xs text-ink">
                    Dev mode code: <span className="tnum font-bold">{debugCode}</span>
                  </p>
                ) : null}

                {error ? <ErrorNote message={error} /> : null}

                <Button type="submit" loading={busy} disabled={!codeValid} className="py-2.5">
                  Verify and sign in
                </Button>

                <p className="text-center text-sm text-muted">
                  Didn&apos;t get it?{' '}
                  {resendIn > 0 ? (
                    <span className="tnum">Resend in {resendIn}s</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void sendOtp()}
                      className="font-semibold text-brand hover:text-brand-deep hover:underline disabled:opacity-50">
                      Resend OTP
                    </button>
                  )}
                </p>
              </form>
            </>
          )}

          <div className="mt-10 flex items-start gap-2 border-t border-line pt-5 text-xs text-muted">
            <LockIcon />
            <span>
              Access is limited to accounts with the admin permission. Every catalog change
              is recorded in the audit log.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

function StepDots({ step }: { step: 'phone' | 'code' }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-muted">
      <span className="h-1.5 w-8 rounded-full bg-brand" />
      <span
        className={`h-1.5 w-8 rounded-full transition ${step === 'code' ? 'bg-brand' : 'bg-line'}`}
      />
      <span className="ml-1">Step {step === 'phone' ? 1 : 2} of 2</span>
    </div>
  );
}

/**
 * One real input under six visual boxes: paste, SMS autofill (`one-time-code`),
 * backspace and screen readers all behave like a normal text field.
 */
function OtpField({
  value,
  onChange,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-ink">One-time code</span>
      <span className="relative block">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(digitsOnly(e.target.value, OTP_DIGITS))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_DIGITS}
          disabled={disabled}
          aria-label="One-time code"
          className="absolute inset-0 z-10 w-full cursor-text opacity-0"
        />
        <span aria-hidden className="grid grid-cols-6 gap-2">
          {Array.from({ length: OTP_DIGITS }, (_, i) => {
            const active =
              focused && (i === value.length || (i === OTP_DIGITS - 1 && value.length === OTP_DIGITS));
            return (
              <span
                key={i}
                className={`tnum flex h-12 items-center justify-center rounded-lg border bg-surface text-xl font-bold text-ink transition ${
                  active
                    ? 'border-brand ring-4 ring-brand/10'
                    : value[i]
                      ? 'border-brand/50'
                      : 'border-line'
                }`}>
                {value[i] ?? ''}
              </span>
            );
          })}
        </span>
      </span>
    </label>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-px size-3.5 shrink-0" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
