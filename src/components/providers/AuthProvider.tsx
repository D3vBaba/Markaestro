"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { useTranslations } from 'next-intl';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import { setTokenGetter, markAuthReady } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

type AuthCtx = {
  user: User | null;
  loading: boolean;
  /** Email a one-time sign-in code (also used to verify an inbox). */
  requestSignInCode: (email: string) => Promise<void>;
  /** Exchange a code for a session. Creates the account on first sign-in. */
  signInWithCode: (email: string, code: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  requestEmailChangeCode: (newEmail: string) => Promise<void>;
  confirmEmailChangeCode: (newEmail: string, code: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
};

const Ctx = createContext<AuthCtx | null>(null);

/**
 * Sync session cookie via server endpoint (signed HttpOnly cookie).
 * On login: POST the ID token so the server can verify + set a signed cookie.
 * On logout: DELETE to clear the cookie.
 */
async function syncSessionCookie(user: User | null) {
  try {
    if (user) {
      const idToken = await user.getIdToken();
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
    } else {
      await fetch('/api/auth/session', { method: 'DELETE' });
    }
  } catch {
    // Non-critical — APIs use ID token auth independently
  }
}

/**
 * Sign in with a popup, falling back to a full-page redirect ONLY when the
 * environment genuinely can't open a popup.
 *
 * We deliberately avoid signInWithRedirect as the default: our authDomain is the
 * marketing apex (markaestro.com) while the app runs on app.markaestro.com, and
 * iOS Safari fails to restore the session after a cross-subdomain redirect — it
 * lands back on /login as if sign-in never happened. signInWithPopup stays
 * first-party (the popup posts the result back to the opener) and works on iOS
 * when opened from a tap, so it's the reliable path on mobile and desktop alike.
 */
async function signInWithProvider(provider: GoogleAuthProvider) {
  try {
    await signInWithPopup(auth, provider);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/web-storage-unsupported'
    ) {
      // The browser can't do popups at all — fall back to a redirect.
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

type AuthErrorTranslator = ReturnType<typeof useTranslations>;

const AUTH_ERROR_KEYS: Record<string, string> = {
  'auth/invalid-email': 'invalidEmail',
  VALIDATION_ERROR: 'invalidEmail',
  'auth/user-disabled': 'userDisabled',
  USER_DISABLED: 'userDisabled',
  OTP_INVALID: 'otpInvalid',
  OTP_EXPIRED: 'otpExpired',
  OTP_TOO_MANY_ATTEMPTS: 'otpTooManyAttempts',
  OTP_COOLDOWN: 'otpCooldown',
  EMAIL_IN_USE: 'emailInUse',
  'auth/too-many-requests': 'rateLimited',
  RATE_LIMITED: 'rateLimited',
  'auth/popup-closed-by-user': 'popupClosed',
  'auth/cancelled-popup-request': 'popupClosed',
  'auth/popup-blocked': 'popupBlocked',
  'auth/account-exists-with-different-credential': 'accountExistsDifferentCredential',
  'auth/network-request-failed': 'networkError',
};

const AUTH_ERROR_FALLBACK_EN: Record<string, string> = {
  invalidEmail: 'Please enter a valid email address.',
  userDisabled: 'This account has been disabled. Contact support.',
  otpInvalid: 'That code is incorrect. Check the latest email and try again.',
  otpExpired: 'That code has expired. Request a new one.',
  otpTooManyAttempts: 'Too many incorrect attempts. Request a new code.',
  otpCooldown: 'A code was just sent. Check your inbox, or retry in a minute.',
  emailInUse: 'An account with this email already exists.',
  rateLimited: 'Too many attempts. Please try again later.',
  popupClosed: 'Sign-in was cancelled.',
  popupBlocked: 'Pop-up was blocked by your browser. Please allow pop-ups and try again.',
  accountExistsDifferentCredential: 'An account already exists with a different sign-in method for this email.',
  networkError: 'Network error. Check your connection and try again.',
  default: 'Authentication failed. Please try again.',
};

/**
 * Map Firebase and code-flow API error codes to user-friendly messages.
 * Pass a translator scoped to `appCommon.authErrors` (e.g.
 * `useTranslations("appCommon.authErrors")`) to localize the result;
 * without one this falls back to English.
 */
export function friendlyAuthError(error: unknown, t?: AuthErrorTranslator): string {
  const code =
    (error as { code?: string })?.code ||
    (error instanceof Error ? error.message : '');
  const key = AUTH_ERROR_KEYS[code] ?? 'default';
  return t ? t(key) : AUTH_ERROR_FALLBACK_EN[key];
}

/** POST JSON to an auth API route; throws Error(code) on non-2xx. */
async function postAuthApi<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  idToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : resp.status === 429
          ? 'RATE_LIMITED'
          : 'INTERNAL_ERROR',
    );
  }
  return data as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Wire up the api-client token getter — waits for auth to be ready
    setTokenGetter(async () => {
      // Wait for Firebase to finish restoring the session
      await auth.authStateReady();
      if (!auth.currentUser) return null;
      return auth.currentUser.getIdToken();
    });

    // Handle redirect result (for mobile Google sign-in)
    getRedirectResult(auth).catch(() => {
      // Redirect result errors are non-critical — user just stays on login
    });

    return onAuthStateChanged(auth, async (u) => {
      // Cookie must be set BEFORE updating state, otherwise the login page
      // navigates to /dashboard before the proxy cookie exists and the
      // proxy redirects back to /login.
      await syncSessionCookie(u);
      setUser(u);
      setLoading(false);
      // Signal to api-client that auth state is resolved
      markAuthReady();
    });
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      requestSignInCode: async (email) => {
        await postAuthApi('/api/auth/otp/request', { email });
      },
      signInWithCode: async (email, code) => {
        const { token } = await postAuthApi<{ token: string }>('/api/auth/otp/verify', { email, code });
        await signInWithCustomToken(auth, token);
      },
      signInGoogle: async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithProvider(provider);
      },
      logout: async () => {
        try {
          const token = await auth.currentUser?.getIdToken();
          if (token) {
            await fetch('/api/auth/logout-all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
          } else {
            await fetch('/api/auth/session', { method: 'DELETE' });
          }
        } catch {
          await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
        }
        await signOut(auth);
        router.replace('/login');
      },
      requestEmailChangeCode: async (newEmail: string) => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('UNAUTHENTICATED');
        await postAuthApi('/api/auth/email-change/request', { newEmail }, token);
      },
      confirmEmailChangeCode: async (newEmail: string, code: string) => {
        const current = auth.currentUser;
        const token = await current?.getIdToken();
        if (!current || !token) throw new Error('UNAUTHENTICATED');
        await postAuthApi('/api/auth/email-change/confirm', { newEmail, code }, token);
        // The email changed server-side — refresh the local user and the
        // session cookie so the new claims are visible immediately.
        await current.getIdToken(true);
        await current.reload();
        await syncSessionCookie(auth.currentUser);
        setUser(auth.currentUser);
      },
      getIdToken: async () => {
        if (!auth.currentUser) return null;
        return auth.currentUser.getIdToken();
      },
    }),
    [user, loading, router]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Like useAuth, but does NOT throw when rendered outside an AuthProvider.
 * Used by shared chrome (e.g. MarketingLayout) that renders on the
 * provider-free (marketing) route group. Returns `user: null` in that case,
 * which is also the correct state on the marketing origin where Firebase auth
 * is not persisted.
 */
export function useOptionalAuth(): { user: User | null; loading: boolean } {
  const ctx = useContext(Ctx);
  if (!ctx) return { user: null, loading: false };
  return { user: ctx.user, loading: ctx.loading };
}
