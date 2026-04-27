import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
