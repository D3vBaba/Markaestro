import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

function resolveAuthDomain() {
  const configured = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();

  if (typeof window === 'undefined') return configured;

  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return configured;

  // signInWithPopup/Redirect open `https://<authDomain>/__/auth/handler`, and the
  // OAuth providers (Google/Facebook) must have that exact URL authorized as a
  // redirect URI. The app subdomain (app.markaestro.com) is NOT provisioned as a
  // redirect URI, so using it made the popup close instantly. Route every
  // markaestro.com host through the marketing apex instead: it is same-site with
  // the app subdomain (so the popup keeps first-party storage) and its
  // /__/auth/handler + provider redirect URIs are already provisioned.
  let marketingHost: string | undefined;
  try {
    marketingHost = process.env.NEXT_PUBLIC_MARKETING_URL
      ? new URL(process.env.NEXT_PUBLIC_MARKETING_URL).hostname
      : undefined;
  } catch {
    marketingHost = undefined;
  }
  if (
    marketingHost &&
    (hostname === marketingHost || hostname.endsWith(`.${marketingHost}`))
  ) {
    return marketingHost;
  }

  return hostname || configured;
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
