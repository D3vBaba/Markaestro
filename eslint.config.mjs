import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import local from "./eslint-rules/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
  ]),
  // Server code logs through `logger`, which emits structured Cloud Logging
  // entries and Sentry breadcrumbs. A bare console call produces neither, so a
  // warning path that uses one is invisible in production: that is exactly how
  // the post-delete reconciliation failure in /api/social/posts went unnoticed.
  //
  // The list below is the set of modules that still predate the logger. It may
  // shrink and must not grow: a new console call in server code is an error.
  {
    files: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
    ignores: [
      "src/lib/__tests__/**",
      // `logger` is the one module that is allowed to reach console: it is
      // what everything else calls instead.
      "src/lib/logger.ts",
      // Pre-existing, each a migration to `logger` waiting to happen.
      "src/lib/fetch-retry.ts",
      "src/lib/platform/meta-graph-api.ts",
      "src/lib/resend.ts",
      "src/lib/social/publisher.ts",
      "src/lib/usage.ts",
      "src/app/api/auth/email-change/confirm/route.ts",
      "src/app/api/auth/email-change/request/route.ts",
      // Directory globs, not file paths: a Next dynamic segment is spelled
      // with brackets, which a glob reads as a character class.
      "src/app/api/oauth/**",
      "src/app/api/stripe/addons/route.ts",
      "src/app/api/stripe/change-plan/route.ts",
      "src/app/api/stripe/checkout/route.ts",
      "src/app/api/stripe/portal/route.ts",
      "src/app/api/stripe/status/route.ts",
      "src/app/api/stripe/webhook/route.ts",
      "src/app/api/team/route.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },
  // An awaited api* call whose result is thrown away is a silent failure.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/__tests__/**"],
    plugins: { local },
    rules: {
      "local/no-floating-api-result": "error",
    },
  },
  // Dashboard and content tools use many dynamic / user-supplied image URLs.
  // Migrating everything to next/image requires remotePatterns for each host;
  // keep lint focused on correctness and turn this off until a dedicated pass.
  {
    files: ["src/app/**/*.{tsx,jsx}", "src/components/**/*.{tsx,jsx}"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
