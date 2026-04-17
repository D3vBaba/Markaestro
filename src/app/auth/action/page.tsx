"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import MarketingLayout from '@/components/layout/MarketingLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Mode = 'resetPassword' | 'verifyEmail' | 'verifyAndChangeEmail' | string;

function friendlyActionError(err: unknown) {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/expired-action-code':
      return 'This link has expired. Please request a new email.';
    case 'auth/invalid-action-code':
      return 'This link is invalid or has already been used.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export default function AuthActionPage() {
  return (
    <Suspense>
      <AuthActionContent />
    </Suspense>
  );
}

function AuthActionContent() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') || '') as Mode;
  const oobCode = searchParams.get('oobCode') || '';
  const continueUrl = searchParams.get('continueUrl') || '/login';

  const [status, setStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');
  const [password, setPassword] = useState('');
  const [emailForReset, setEmailForReset] = useState<string | null>(null);

  const canProceed = useMemo(() => Boolean(oobCode && mode), [oobCode, mode]);

  useEffect(() => {
    if (!canProceed) {
      setStatus('error');
      setMessage('Missing or invalid action parameters.');
      return;
    }

    if (mode === 'resetPassword') {
      setStatus('working');
      verifyPasswordResetCode(auth, oobCode)
        .then((email) => {
          setEmailForReset(email);
          setStatus('idle');
        })
        .catch((err) => {
          setStatus('error');
          setMessage(friendlyActionError(err));
        });
      return;
    }

    if (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') {
      setStatus('working');
      applyActionCode(auth, oobCode)
        .then(() => {
          setStatus('success');
          setMessage(mode === 'verifyEmail' ? 'Email verified successfully.' : 'Email updated successfully.');
        })
        .catch((err) => {
          setStatus('error');
          setMessage(friendlyActionError(err));
        });
      return;
    }

    setStatus('error');
    setMessage('Unsupported action.');
  }, [canProceed, mode, oobCode]);

  return (
    <MarketingLayout>
      <div className="mx-auto w-full max-w-lg p-6 min-h-[calc(100vh-4rem)] flex items-center">
        <Card className="w-full border-border/40 shadow-lg">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-[family-name:var(--font-display)] font-normal">
              {mode === 'resetPassword'
                ? 'Set a new password'
                : mode === 'verifyEmail'
                  ? 'Verify your email'
                  : mode === 'verifyAndChangeEmail'
                    ? 'Confirm email change'
                    : 'Account action'}
            </CardTitle>
            <CardDescription>
              {mode === 'resetPassword'
                ? 'Choose a new password for your account.'
                : 'Complete the requested action.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === 'error' && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-600">
                {message || 'Something went wrong.'}
              </p>
            )}
            {status === 'success' && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">
                {message || 'Done.'}
              </p>
            )}

            {mode === 'resetPassword' ? (
              <div className="space-y-3">
                {emailForReset && (
                  <p className="text-xs text-muted-foreground">
                    Resetting password for <span className="font-medium text-foreground">{emailForReset}</span>
                  </p>
                )}
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  type="password"
                  className="h-11 rounded-xl"
                  disabled={status === 'working' || status === 'success'}
                />
                <Button
                  className="h-11 w-full rounded-xl"
                  disabled={status === 'working' || status === 'success' || password.trim().length < 6}
                  onClick={async () => {
                    try {
                      setStatus('working');
                      setMessage('');
                      await confirmPasswordReset(auth, oobCode, password);
                      setStatus('success');
                      setMessage('Password updated successfully. You can now sign in.');
                    } catch (err) {
                      setStatus('error');
                      setMessage(friendlyActionError(err));
                    }
                  }}
                >
                  {status === 'working' ? 'Updating…' : 'Update password'}
                </Button>
                <a className="block text-center text-xs text-primary hover:underline" href="/login">
                  Back to sign in
                </a>
              </div>
            ) : (
              <div className="space-y-3">
                {status === 'working' && (
                  <p className="text-xs text-muted-foreground">Working…</p>
                )}
                <a
                  className="block text-center text-xs text-primary hover:underline"
                  href={continueUrl.startsWith('/') ? continueUrl : '/login'}
                >
                  Continue
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}

