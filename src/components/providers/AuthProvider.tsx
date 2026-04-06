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
  sendPasswordResetEmail,
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

/** Check if the device is likely mobile (used to decide popup vs redirect). */
function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
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

    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      syncSessionCookie(u);
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
        await createUserWithEmailAndPassword(auth, email, password);
      },
      signInGoogle: async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        if (isMobile()) {
          await signInWithRedirect(auth, provider);
        } else {
          await signInWithPopup(auth, provider);
        }
      },
      signInFacebook: async () => {
        const provider = new FacebookAuthProvider();
        if (isMobile()) {
          await signInWithRedirect(auth, provider);
        } else {
          await signInWithPopup(auth, provider);
        }
      },
      logout: async () => {
        await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
        await signOut(auth);
        router.replace('/login');
      },
      resetPassword: async (email: string) => {
        await sendPasswordResetEmail(auth, email);
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
