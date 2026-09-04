"use client";

import Link from "next/link";

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import MarketingLayout from '@/components/layout/MarketingLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Mode = 'resetPassword' | 'verifyEmail' | 'verifyAndChangeEmail' | string;

const ACTION_ERROR_KEYS: Record<string, string> = {
  'auth/expired-action-code': 'expiredActionCode',
  'auth/invalid-action-code': 'invalidActionCode',
  'auth/user-disabled': 'userDisabled',
  'auth/weak-password': 'weakPassword',
};

function friendlyActionError(err: unknown, t: ReturnType<typeof useTranslations>) {
  const code = (err as { code?: string })?.code || '';
  return t(`errors.${ACTION_ERROR_KEYS[code] ?? 'default'}`);
}

export default function AuthActionPage() {
  return (
    <Suspense>
      <AuthActionContent />
    </Suspense>
  );
}

function AuthActionContent() {
  const t = useTranslations('auth.authAction');
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
            setMessage(friendlyActionError(err, t));
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
              mode === 'verifyEmail' ? t('emailVerifiedSuccess') : t('emailUpdatedSuccess'),
            );
          }
        } catch (err) {
          if (!cancelled) {
            setStatus('error');
            setMessage(friendlyActionError(err, t));
          }
        }
        return;
      }

      if (!cancelled) {
        setStatus('error');
        setMessage(t('unsupportedAction'));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [canProceed, mode, oobCode, t]);

  const titleLabel =
    mode === 'resetPassword'
      ? t('titles.resetPassword')
      : mode === 'verifyEmail'
        ? t('titles.verifyEmail')
        : mode === 'verifyAndChangeEmail'
          ? t('titles.verifyAndChangeEmail')
          : t('titles.default');

  if (!canProceed) {
    return (
      <MarketingLayout hideLocaleSwitcher>
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md items-center px-5 py-10">
          <div
            className="w-full rounded-2xl border border-border bg-card p-6 sm:p-8"
          >
            <h1
              className="m-0 text-xl font-semibold tracking-tight text-foreground"
            >
              {t('canceledFallback.title')}
            </h1>
            <p
              className="m-0 mt-1.5 text-[13px] leading-5 text-muted-foreground"
            >
              {t('canceledFallback.subtitle')}
            </p>
            <p className="m-0 mt-5 text-[13px] leading-5 text-mk-neg" role="alert">
              {t('canceledFallback.message')}
            </p>
            <Link
              className="mt-4 block text-center text-[13px] font-medium text-mk-accent underline-offset-4 hover:underline"
              href="/login"
            >
              {t('canceledFallback.backToSignIn')}
            </Link>
          </div>
        </div>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout hideLocaleSwitcher>
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md items-center px-5 py-10">
        <div
          className="w-full rounded-2xl border border-border bg-card p-6 sm:p-8"
        >
                    <h1
            className="m-0 text-xl font-semibold tracking-tight text-foreground"
          >
            {titleLabel}
          </h1>
          <p
            className="m-0 mt-1.5 text-[13px] leading-5 text-muted-foreground"
          >
            {mode === 'resetPassword'
              ? t('subtitles.resetPassword')
              : t('subtitles.default')}
          </p>

          <div className="mt-6 flex flex-col gap-4">
            {status === 'error' && (
              <p
                className="m-0 text-[13px] leading-5 text-mk-neg" role="alert"
              >
                {message || t('genericError')}
              </p>
            )}
            {status === 'success' && (
              <p
                className="m-0 text-[13px] leading-5 text-mk-pos" role="status"
              >
                {message || t('genericSuccess')}
              </p>
            )}

            {mode === 'resetPassword' ? (
              <div className="flex flex-col gap-3">
                {emailForReset && (
                  <p
                    className="m-0 text-[13px] text-muted-foreground"
                  >
                    {t.rich('resettingPasswordFor', {
                      email: () => (
                        <span className="font-medium text-foreground">
                          {emailForReset}
                        </span>
                      ),
                    })}
                  </p>
                )}
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('newPasswordPlaceholder')}
                  type="password"
                  className="h-11"
                  disabled={status === 'working' || status === 'success'}
                />
                <Button
                  size="lg" className="w-full"
                  disabled={status === 'working' || status === 'success' || password.trim().length < 6}
                  onClick={async () => {
                    try {
                      setStatus('working');
                      setMessage('');
                      await confirmPasswordReset(auth, oobCode, password);
                      setStatus('success');
                      setMessage(t('passwordUpdatedSuccess'));
                    } catch (err) {
                      setStatus('error');
                      setMessage(friendlyActionError(err, t));
                    }
                  }}
                >
                  {status === 'working' ? t('updating') : t('updatePassword')}
                </Button>
                <Link
                  className="block text-center text-[13px] font-medium text-mk-accent underline-offset-4 hover:underline"
                  href="/login"
                >
                  {t('backToSignIn')}
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {status === 'working' && (
                  <p
                    className="m-0 text-[13px] text-muted-foreground"
                  >
                    {t('working')}
                  </p>
                )}
                <a
                  className="block text-center text-[13px] font-medium text-mk-accent underline-offset-4 hover:underline"
                  href={continueUrl.startsWith('/') ? continueUrl : '/login'}
                >
                  {t('continue')}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
