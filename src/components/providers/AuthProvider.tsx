"use client";

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInFacebook: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  requestEmailChange: (newEmail: string) => Promise<void>;
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
async function signInWithProvider(
  provider: GoogleAuthProvider | FacebookAuthProvider,
) {
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

/** Map Firebase error codes to user-friendly messages. */
export function friendlyAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Pop-up was blocked by your browser. Please allow pop-ups and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with a different sign-in method for this email.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Authentication failed. Please try again.';
  }
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

    // Handle redirect result (for mobile Google/Facebook sign-in)
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
      signInEmail: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password);
      },
      signUpEmail: async (email, password) => {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        // Fire-and-forget: email verification is delivered via Resend (server-generated action link)
        try {
          const idToken = await cred.user.getIdToken();
          await fetch('/api/auth/emails/verify-email', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
          });
        } catch {
          // Non-critical; user can resend from Settings
        }
      },
      signInGoogle: async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithProvider(provider);
      },
      signInFacebook: async () => {
        const provider = new FacebookAuthProvider();
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
      resetPassword: async (email: string) => {
        await fetch('/api/auth/emails/password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      },
      sendVerificationEmail: async () => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('UNAUTHENTICATED');
        await fetch('/api/auth/emails/verify-email', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      },
      requestEmailChange: async (newEmail: string) => {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('UNAUTHENTICATED');
        await fetch('/api/auth/emails/email-change', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ newEmail }),
        });
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
