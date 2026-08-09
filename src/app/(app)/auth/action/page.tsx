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
import { pillStyle } from '@/components/mk/pills';

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

  const eyebrow =
    mode === 'resetPassword'
      ? t('eyebrows.resetPassword')
      : mode === 'verifyEmail'
        ? t('eyebrows.verifyEmail')
        : mode === 'verifyAndChangeEmail'
          ? t('eyebrows.verifyAndChangeEmail')
          : t('eyebrows.default');

  if (!canProceed) {
    return (
      <MarketingLayout hideLocaleSwitcher>
        <div className="mx-auto w-full max-w-lg p-6 min-h-[calc(100vh-4rem)] flex items-center">
          <div
            className="w-full rounded-xl p-6 sm:p-7"
            style={{
              background: 'var(--mk-paper)',
              border: '1px solid var(--mk-rule)',
            }}
          >
            <p className="mk-eyebrow">{t('canceledFallback.eyebrow')}</p>
            <h1
              className="mt-1.5 text-[22px] sm:text-[24px] font-semibold m-0"
              style={{ color: 'var(--mk-ink)', letterSpacing: '-0.025em' }}
            >
              {t('canceledFallback.title')}
            </h1>
            <p
              className="mt-1.5 text-[13px]"
              style={{ color: 'var(--mk-ink-60)' }}
            >
              {t('canceledFallback.subtitle')}
            </p>
            <p
              className="mt-5 rounded-lg px-3.5 py-2.5 text-[12px]"
              style={pillStyle('neg')}
            >
              {t('canceledFallback.message')}
            </p>
            <Link
              className="mt-4 block text-center text-[12px] font-medium hover:underline"
              style={{ color: 'var(--mk-accent)' }}
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
              ? t('subtitles.resetPassword')
              : t('subtitles.default')}
          </p>

          <div className="mt-5 flex flex-col gap-3">
            {status === 'error' && (
              <p
                className="rounded-lg px-3.5 py-2.5 text-[12px]"
                style={pillStyle('neg')}
              >
                {message || t('genericError')}
              </p>
            )}
            {status === 'success' && (
              <p
                className="rounded-lg px-3.5 py-2.5 text-[12px]"
                style={pillStyle('pos')}
              >
                {message || t('genericSuccess')}
              </p>
            )}

            {mode === 'resetPassword' ? (
              <div className="flex flex-col gap-3">
                {emailForReset && (
                  <p
                    className="text-[12px]"
                    style={{ color: 'var(--mk-ink-60)' }}
                  >
                    {t.rich('resettingPasswordFor', {
                      email: () => (
                        <span className="font-medium" style={{ color: 'var(--mk-ink)' }}>
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
                  className="block text-center text-[12px] font-medium hover:underline"
                  style={{ color: 'var(--mk-accent)' }}
                  href="/login"
                >
                  {t('backToSignIn')}
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {status === 'working' && (
                  <p
                    className="text-[12px]"
                    style={{ color: 'var(--mk-ink-60)' }}
                  >
                    {t('working')}
                  </p>
                )}
                <a
                  className="block text-center text-[12px] font-medium hover:underline"
                  style={{ color: 'var(--mk-accent)' }}
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
