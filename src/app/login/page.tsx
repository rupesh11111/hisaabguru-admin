'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button, Card, ErrorNote, Input } from '@/components/ui';
import { ApiError, authApi, setToken } from '@/lib/api';
import { hasAdminAccess, useSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const { state, refresh } = useSession();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in with a valid admin session — skip the form entirely.
  useEffect(() => {
    if (state.status === 'authenticated' && hasAdminAccess(state.user)) {
      router.replace('/');
    }
  }, [state, router]);

  const sendOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestOtp(phone.trim());
      setDebugCode(res.debugCode ?? null);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the OTP');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.verifyOtp(phone.trim(), code.trim());
      setToken(res.accessToken);
      await refresh();
      // The session provider re-reads /auth/me; the redirect above takes over once
      // it confirms admin access. A non-admin gets the message below instead.
      const me = await authApi.me();
      if (!hasAdminAccess(me)) {
        setToken(null);
        setError('This number does not have admin access');
        return;
      }
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the OTP');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-black text-ink">hisaabGuru Admin</h1>
          <p className="mt-1 text-sm text-muted">
            Manage the catalog, shops, users and plans.
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            {step === 'phone' ? (
              <>
                <Input
                  label="Phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210"
                  inputMode="tel"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && phone.trim()) void sendOtp();
                  }}
                  hint="The number that has admin access."
                />
                {error ? <ErrorNote message={error} /> : null}
                <Button onClick={() => void sendOtp()} loading={busy} disabled={!phone.trim()}>
                  Send OTP
                </Button>
              </>
            ) : (
              <>
                <Input
                  label="OTP"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim()) void verify();
                  }}
                  hint={debugCode ? `Dev mode code: ${debugCode}` : `Sent to ${phone}`}
                />
                {error ? <ErrorNote message={error} /> : null}
                <Button onClick={() => void verify()} loading={busy} disabled={!code.trim()}>
                  Verify and sign in
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep('phone');
                    setCode('');
                    setError(null);
                  }}>
                  Change number
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
