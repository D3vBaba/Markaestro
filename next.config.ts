import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '';
const FIREBASE_PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

// Conservative report-only CSP. We deliberately ship this in Report-Only
// mode first so any missed origins surface as `report-uri` events without
// breaking the app. Flip to `Content-Security-Policy` after a clean soak.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  // Next.js injects inline runtime bootstrap; keep 'unsafe-inline' until we wire nonces.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com https://lh3.googleusercontent.com https://*.fbcdn.net https://graph.facebook.com https://*.tiktokcdn.com https://*.licdn.com",
  "media-src 'self' https://firebasestorage.googleapis.com https://storage.googleapis.com blob:",
  "connect-src 'self' https://*.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://api.stripe.com https://*.ingest.sentry.io https://*.sentry.io https://graph.facebook.com https://graph.instagram.com https://api.linkedin.com https://open-api.tiktok.com https://open.tiktokapis.com https://business-api.tiktok.com" +
    (FIREBASE_AUTH_DOMAIN ? ` https://${FIREBASE_AUTH_DOMAIN}` : '') +
    (FIREBASE_PROJECT ? ` https://${FIREBASE_PROJECT}.firebaseapp.com https://${FIREBASE_PROJECT}.web.app` : '') +
    (APP_URL ? ` ${APP_URL}` : ''),
  "frame-src 'self' https://accounts.google.com https://apis.google.com https://checkout.stripe.com https://js.stripe.com" +
    (FIREBASE_AUTH_DOMAIN ? ` https://${FIREBASE_AUTH_DOMAIN}` : '') +
    (FIREBASE_PROJECT ? ` https://${FIREBASE_PROJECT}.firebaseapp.com` : ''),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['firebase-admin'],
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
  async headers() {
    return [
      {
        // Apply to all routes, including API. Non-HTML API responses benefit
        // from HSTS / nosniff / frame-deny too.
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/__/auth/:path*',
        destination: `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  disableLogger: true,
});
