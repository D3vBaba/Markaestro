import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
  "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com https://lh3.googleusercontent.com https://*.fbcdn.net https://graph.facebook.com https://*.tiktokcdn.com https://*.pinimg.com",
  "media-src 'self' https://firebasestorage.googleapis.com https://storage.googleapis.com blob:",
  "connect-src 'self' https://*.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://api.stripe.com https://*.ingest.sentry.io https://*.sentry.io https://graph.facebook.com https://graph.instagram.com https://graph.threads.net https://api.pinterest.com https://api-sandbox.pinterest.com https://open-api.tiktok.com https://open.tiktokapis.com https://business-api.tiktok.com" +
    (FIREBASE_AUTH_DOMAIN ? ` https://${FIREBASE_AUTH_DOMAIN}` : '') +
    (FIREBASE_PROJECT ? ` https://${FIREBASE_PROJECT}.firebaseapp.com https://${FIREBASE_PROJECT}.web.app` : '') +
    (APP_URL ? ` ${APP_URL}` : ''),
  "frame-src 'self' https://accounts.google.com https://apis.google.com https://checkout.stripe.com https://js.stripe.com" +
    (FIREBASE_AUTH_DOMAIN ? ` https://${FIREBASE_AUTH_DOMAIN}` : '') +
  (FIREBASE_PROJECT ? ` https://${FIREBASE_PROJECT}.firebaseapp.com` : ''),
  "worker-src 'self' blob:",
  "object-src 'none'",
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

const FFMPEG_TRACE_FILES = [
  './node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg',
  './node_modules/@ffmpeg-installer/darwin-x64/ffmpeg',
  './node_modules/@ffmpeg-installer/linux-arm/ffmpeg',
  './node_modules/@ffmpeg-installer/linux-arm64/ffmpeg',
  './node_modules/@ffmpeg-installer/linux-ia32/ffmpeg',
  './node_modules/@ffmpeg-installer/linux-x64/ffmpeg',
  './node_modules/@ffmpeg-installer/win32-ia32/ffmpeg.exe',
  './node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe',
];

// @google-cloud/tasks loads this descriptor dynamically at runtime. Next's
// standalone tracer cannot see that lookup, so include it explicitly for App
// Hosting rather than allowing worker/API routes to fail after deployment.
const GOOGLE_CLOUD_TASKS_TRACE_FILES = [
  './node_modules/@google-cloud/tasks/build/protos/protos.json',
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Dev-only: when the app is reached through a tunnel (e.g. ngrok, so TikTok
  // can hit the OAuth callback and PULL_FROM_URL a public media URL), the
  // request Host is not localhost and Next blocks its own dev asset/HMR
  // requests as cross-origin. Follows whatever NEXT_PUBLIC_APP_URL points at.
  // Next only reads this in dev, but it is gated on NODE_ENV anyway so the
  // production config never carries a host list it has no use for.
  allowedDevOrigins:
    process.env.NODE_ENV !== 'production' && APP_URL && !APP_URL.includes('localhost')
      ? [new URL(APP_URL).host]
      : [],
  transpilePackages: ['firebase-admin'],
  // gRPC transport (google-gax) uses dynamic requires Turbopack can't
  // statically bundle; keep it a runtime dependency of the standalone output.
  serverExternalPackages: ['@google-cloud/tasks'],
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    '/*': GOOGLE_CLOUD_TASKS_TRACE_FILES,
    '/api/posts/[id]/publish': FFMPEG_TRACE_FILES,
    '/api/public/v1/posts/[id]/publish': FFMPEG_TRACE_FILES,
    '/api/worker/tick': FFMPEG_TRACE_FILES,
    '/api/worker/tiktok-poll': FFMPEG_TRACE_FILES,
  },
  // Next.js 16 caps proxied request bodies at 10 MB by default — videos
  // up to MAX_VIDEO_SIZE (250 MB, see /api/ai/images and /api/public/v1/media)
  // were silently truncated and failing formData() parsing with a 500.
  // Allow 260 MB to cover the 250 MB payload plus multipart overhead.
  experimental: {
    proxyClientMaxBodySize: '260mb',
  },
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
      // Common crawler alias for the existing public/llms.txt brief.
      { source: '/ai.txt', destination: '/llms.txt' },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  disableLogger: true,
});
