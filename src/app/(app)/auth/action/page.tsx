"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import MarketingLayout from '@/components/layout/MarketingLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { pillStyle } from '@/components/mk/pills';

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
    if (!canProceed) return;

    let cancelled = false;

    const run = async () => {
      if (mode === 'resetPassword') {
        try {
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (!cancelled) {
            setEmailForReset(email);
            setStatus('idle');
          }
        } catch (err) {
          if (!cancelled) {
            setStatus('error');
            setMessage(friendlyActionError(err));
          }
        }
        return;
      }

      if (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') {
        try {
          await applyActionCode(auth, oobCode);
          if (!cancelled) {
            setStatus('success');
            setMessage(
              mode === 'verifyEmail' ? 'Email verified successfully.' : 'Email updated successfully.',
            );
          }
        } catch (err) {
          if (!cancelled) {
            setStatus('error');
            setMessage(friendlyActionError(err));
          }
        }
        return;
      }

      if (!cancelled) {
        setStatus('error');
        setMessage('Unsupported action.');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [canProceed, mode, oobCode]);

  const titleLabel =
    mode === 'resetPassword'
      ? 'Set a new password'
      : mode === 'verifyEmail'
        ? 'Verify your email'
        : mode === 'verifyAndChangeEmail'
          ? 'Confirm email change'
          : 'Account action';

  const eyebrow =
    mode === 'resetPassword'
      ? 'Reset'
      : mode === 'verifyEmail'
        ? 'Verify'
        : mode === 'verifyAndChangeEmail'
          ? 'Confirm'
          : 'Account';

  if (!canProceed) {
    return (
      <MarketingLayout>
        <div className="mx-auto w-full max-w-lg p-6 min-h-[calc(100vh-4rem)] flex items-center">
          <div
            className="w-full rounded-xl p-6 sm:p-7"
            style={{
              background: 'var(--mk-paper)',
              border: '1px solid var(--mk-rule)',
            }}
          >
            <p className="mk-eyebrow">Account</p>
            <h1
              className="mt-1.5 text-[22px] sm:text-[24px] font-semibold m-0"
              style={{ color: 'var(--mk-ink)', letterSpacing: '-0.025em' }}
            >
              Account action
            </h1>
            <p
              className="mt-1.5 text-[13px]"
              style={{ color: 'var(--mk-ink-60)' }}
            >
              We could not complete this link.
            </p>
            <p
              className="mt-5 rounded-lg px-3.5 py-2.5 text-[12px]"
              style={pillStyle('neg')}
            >
              Missing or invalid action parameters.
            </p>
            <a
              className="mt-4 block text-center text-[12px] font-medium hover:underline"
              style={{ color: 'var(--mk-accent)' }}
              href="/login"
            >
              Back to sign in
            </a>
          </div>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      <div className="mx-auto w-full max-w-lg p-6 min-h-[calc(100vh-4rem)] flex items-center">
        <div
          className="w-full rounded-xl p-6 sm:p-7"
          style={{
            background: 'var(--mk-paper)',
            border: '1px solid var(--mk-rule)',
          }}
        >
          <p className="mk-eyebrow">{eyebrow}</p>
          <h1
            className="mt-1.5 text-[22px] sm:text-[24px] font-semibold m-0"
            style={{ color: 'var(--mk-ink)', letterSpacing: '-0.025em' }}
          >
            {titleLabel}
          </h1>
          <p
            className="mt-1.5 text-[13px]"
            style={{ color: 'var(--mk-ink-60)' }}
          >
            {mode === 'resetPassword'
              ? 'Choose a new password for your account.'
              : 'Complete the requested action.'}
          </p>

          <div className="mt-5 flex flex-col gap-3">
            {status === 'error' && (
              <p
                className="rounded-lg px-3.5 py-2.5 text-[12px]"
                style={pillStyle('neg')}
              >
                {message || 'Something went wrong.'}
              </p>
            )}
            {status === 'success' && (
              <p
                className="rounded-lg px-3.5 py-2.5 text-[12px]"
                style={pillStyle('pos')}
              >
                {message || 'Done.'}
              </p>
            )}

            {mode === 'resetPassword' ? (
              <div className="flex flex-col gap-3">
                {emailForReset && (
                  <p
                    className="text-[12px]"
                    style={{ color: 'var(--mk-ink-60)' }}
                  >
                    Resetting password for{' '}
                    <span
                      className="font-medium"
                      style={{ color: 'var(--mk-ink)' }}
                    >
                      {emailForReset}
                    </span>
                  </p>
                )}
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  type="password"
                  className="h-11 rounded-lg text-[13.5px]"
                  disabled={status === 'working' || status === 'success'}
                />
                <Button
                  className="h-11 w-full rounded-lg text-[13.5px]"
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
                <a
                  className="block text-center text-[12px] font-medium hover:underline"
                  style={{ color: 'var(--mk-accent)' }}
                  href="/login"
                >
                  Back to sign in
                </a>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {status === 'working' && (
                  <p
                    className="text-[12px]"
                    style={{ color: 'var(--mk-ink-60)' }}
                  >
                    Working…
                  </p>
                )}
                <a
                  className="block text-center text-[12px] font-medium hover:underline"
                  style={{ color: 'var(--mk-accent)' }}
                  href={continueUrl.startsWith('/') ? continueUrl : '/login'}
                >
                  Continue
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
