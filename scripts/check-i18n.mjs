#!/usr/bin/env node
/**
 * i18n completeness gate for src/messages/{locale}/{namespace}.json.
 *
 * Two independent checks, run against every non-English locale relative to
 * `en` (the source of truth):
 *
 *   1. Key-shape completeness — every key present in en.json must exist in
 *      every locale file, and vice versa (no missing keys, no orphaned
 *      leftovers from a since-removed English key). This check is exact —
 *      any mismatch is a real bug.
 *
 *   2. Untranslated-value heuristic — flags string values that are still
 *      byte-identical to the English source and "look like prose" (see
 *      isLikelyProse below), which usually means a locale file was bootstrap-
 *      copied from English and never actually translated. This is a
 *      heuristic, not a hard proof: legitimately-identical short strings
 *      (brand names, HTTP methods, error codes, paths, emails, URLs) are
 *      excluded so it doesn't flag noise — see EXEMPT_PATTERNS and
 *      KNOWN_TOKENS.
 *
 * Usage:
 *   node scripts/check-i18n.mjs            # human-readable report
 *   node scripts/check-i18n.mjs --json      # machine-readable, for CI
 *
 * Exit code 0 = clean, 1 = one or more locales have real issues.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(__dirname, '..', 'src', 'messages');
const SOURCE_LOCALE = 'en';

// Values matching any of these are legitimately identical across locales —
// technical tokens, not prose that should have been translated.
const EXEMPT_PATTERNS = [
  /^[A-Z][A-Z0-9_*]{2,}$/, // SCREAMING_SNAKE_CASE error codes: UNAUTHENTICATED, VALIDATION_*
  /^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/, // HTTP methods
  /^[#/][\w\-/:.#]*$/, // path-like: /api/public/v1/posts, #connect-api
  /^https?:\/\//, // URLs
  /^[\w.+-]+@[\w-]+\.[\w.-]+$/, // emails
  /^-?\$?\d+([.,]\d+)?%?$/, // bare numbers, currency, percentages
  /^\d{2,4}-\d{2}-\d{2}/, // ISO-ish dates
  /^[\w-]+(\.[a-z]{2,})+$/i, // bare domain placeholders: yourbrand.com
];

// Proper nouns / acronyms that legitimately never translate. Checked as
// whole words so e.g. "API" doesn't suppress a real sentence containing it.
const KNOWN_TOKENS = new Set([
  'Markaestro', 'TikTok', 'Meta', 'Facebook', 'Instagram', 'LinkedIn',
  'Threads', 'Pinterest', 'Firebase', 'Sentry', 'Stripe', 'Google', 'Cloud',
  'Claude', 'OpenAI', 'MCP', 'SDK', 'API', 'APIs', 'JSON', 'HTTP', 'HTTPS',
  'OAuth', 'HMAC', 'CSV', 'URL', 'ID', 'IDs', 'n8n', 'Make', 'Zapier',
  'LangChain', 'LlamaIndex', 'Delaware', 'GDPR', 'CCPA', 'EEA', 'UK', 'U.S.',
  'US$100', 'GB', 'MB', 'KB',
  // Deliberately kept as literal plan/SKU names across every locale — common
  // SaaS practice (Stripe, Notion, ...) so "the Business plan" means the same
  // thing in support tickets regardless of UI language. "Social" and "Legal"
  // are true cognates across the Romance languages in this set (es/fr/it/pt).
  'Starter', 'Pro', 'Business', 'Social', 'Legal',
  // Loanwords carried into every locale in this set unchanged — translating
  // "Zoom" into de/es/fr/it/pt would read as worse UI, not better.
  'Zoom',
  // Product, feature, format and integration names that never localize:
  // DripCheckr (placeholder brand in wizards), Meta Business Suite,
  // Instagram/Meta Login, TikTok for Developers, the Connect API, TikTok's
  // Stitch, the WebM container in media-size hints.
  'DripCheckr', 'Suite', 'Login', 'Developers', 'Connect', 'Stitch', 'WebM',
  'WebP',
  'Endpoint', 'SaaS', 'Fintech',
  // Cognates and loanwords the de/es/fr/it/nl/pt locale set keeps unchanged —
  // each verified against how those locale files already use the word rather
  // than assumed. The CJK/ar locales translate these, so identical values
  // never arise there and the exemption is inert for them.
  'Account', 'Accent', 'Actions', 'Active', 'Analyst', 'Analytics',
  'Audience', 'Beta', 'Brand', 'brand', 'Code', 'commerce', 'Compare',
  'Contact', 'Content', 'Creator', 'Dashboard', 'Description', 'Disclaimers',
  'Discovery', 'Email', 'Engagement', 'Feedback', 'Fitness', 'Format',
  'Gaming', 'Hardware', 'Health', 'Help', 'Home', 'Image', 'Images',
  'Infrastructure', 'intelligence', 'Live', 'Logo', 'Marketer', 'Marketing',
  'Marketplace', 'Media', 'media', 'Message', 'Mobile', 'Name', 'Navigation',
  'Open', 'optional', 'Pages', 'Platform', 'Post', 'post', 'Posts', 'posts',
  'Privacy', 'Product', 'production', 'Professional', 'Question', 'Repost',
  'Status', 'Support', 'Team', 'Tech', 'Text', 'Timing', 'Upload', 'Videos',
  'Website', 'workflow', 'workspace', 'workspaces', 'Workspaces',
]);

// Specific key paths that are intentionally identical in every locale — code/
// tool-context labels ("bash", "tools.json", "system prompt") rather than
// prose, and the literal <upload_url> placeholder used in an API path example.
const EXEMPT_KEY_PATHS = new Set([
  'quickstart.bashLabel',
  'recipes.bashLabel',
  'toolDefs.schemasLabel',
  'toolDefs.briefLabel',
  'connectApi.endpoints[3].path',
]);

function isExempt(value, keyPath) {
  if (keyPath && EXEMPT_KEY_PATHS.has(keyPath)) return true;
  if (EXEMPT_PATTERNS.some((re) => re.test(value))) return true;
  return false;
}

// ICU arguments and markup are never prose: "{current} / {limit}",
// "${price}", "<strong>{oldEmail}</strong>" and "<uploadSession.uploadUrl>"
// are format scaffolding that reads identically in every locale. Strip {…}
// iteratively so nested ICU plural/select bodies unwrap too — their option
// text goes with them, an accepted blind spot — then drop <…> tokens.
function stripFormatting(value) {
  let prev;
  do {
    prev = value;
    value = value.replace(/\{[^{}]*\}/g, ' ');
  } while (value !== prev);
  return value.replace(/<[^<>]*>/g, ' ');
}

// A value "looks like prose" if, after stripping format scaffolding and known
// tokens/punctuation, it still has a run of 4+ alphabetic characters — i.e. a
// real word that isn't on the allowlist. Short labels ("Copy", "Pricing") are
// intentionally still flagged: those DO need translation, they're just short.
function isLikelyProse(value, keyPath) {
  if (typeof value !== 'string') return false;
  if (value.trim().length < 3) return false;
  if (isExempt(value.trim(), keyPath)) return false;
  const words = stripFormatting(value).match(/[A-Za-zÀ-ÖØ-öø-ÿ]{4,}/g) || [];
  return words.some((w) => !KNOWN_TOKENS.has(w));
}

function flattenKeys(obj, prefix = '') {
  const out = new Map();
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      const path = `${prefix}[${i}]`;
      if (item && typeof item === 'object') {
        for (const [k, v] of flattenKeys(item, path)) out.set(k, v);
      } else {
        out.set(path, item);
      }
    });
    return out;
  }
  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') {
        for (const [k, v] of flattenKeys(value, path)) out.set(k, v);
      } else {
        out.set(path, value);
      }
    }
    return out;
  }
  out.set(prefix, obj);
  return out;
}

function loadNamespace(locale, namespace) {
  const path = join(MESSAGES_DIR, locale, `${namespace}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const asJson = process.argv.includes('--json');

  const locales = readdirSync(MESSAGES_DIR).filter((d) => d !== SOURCE_LOCALE).sort();
  const namespaces = readdirSync(join(MESSAGES_DIR, SOURCE_LOCALE))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();

  const report = {};
  let hasIssues = false;

  for (const locale of locales) {
    report[locale] = {};
    for (const namespace of namespaces) {
      const en = flattenKeys(loadNamespace(SOURCE_LOCALE, namespace));
      let target;
      try {
        target = flattenKeys(loadNamespace(locale, namespace));
      } catch (e) {
        report[locale][namespace] = { error: `failed to load: ${e.message}` };
        hasIssues = true;
        continue;
      }

      const missingKeys = [...en.keys()].filter((k) => !target.has(k));
      const extraKeys = [...target.keys()].filter((k) => !en.has(k));
      const untranslated = [...en.keys()].filter((k) => {
        if (!target.has(k)) return false;
        const enVal = en.get(k);
        const targetVal = target.get(k);
        return enVal === targetVal && isLikelyProse(enVal, k);
      });

      if (missingKeys.length || extraKeys.length || untranslated.length) {
        hasIssues = true;
        report[locale][namespace] = {
          missingKeys,
          extraKeys,
          untranslatedCount: untranslated.length,
          untranslatedSample: untranslated.slice(0, 8),
        };
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(hasIssues ? 1 : 0);
  }

  if (!hasIssues) {
    console.log(`✓ All ${locales.length} locales complete across ${namespaces.length} namespaces — no missing keys, no untranslated prose detected.`);
    process.exit(0);
  }

  console.log(`i18n completeness check — ${locales.length} locales, ${namespaces.length} namespaces\n`);
  for (const [locale, namespaceIssues] of Object.entries(report)) {
    const entries = Object.entries(namespaceIssues);
    if (!entries.length) continue;
    console.log(`\x1b[1m${locale}\x1b[0m`);
    for (const [namespace, issue] of entries) {
      if (issue.error) {
        console.log(`  \x1b[31m✗ ${namespace}: ${issue.error}\x1b[0m`);
        continue;
      }
      const parts = [];
      if (issue.missingKeys.length) parts.push(`${issue.missingKeys.length} missing`);
      if (issue.extraKeys.length) parts.push(`${issue.extraKeys.length} extra`);
      if (issue.untranslatedCount) parts.push(`${issue.untranslatedCount} untranslated`);
      console.log(`  \x1b[33m✗ ${namespace}\x1b[0m — ${parts.join(', ')}`);
      if (issue.missingKeys.length) console.log(`      missing: ${issue.missingKeys.slice(0, 5).join(', ')}${issue.missingKeys.length > 5 ? ', ...' : ''}`);
      if (issue.extraKeys.length) console.log(`      extra:   ${issue.extraKeys.slice(0, 5).join(', ')}${issue.extraKeys.length > 5 ? ', ...' : ''}`);
      if (issue.untranslatedSample.length) console.log(`      e.g.:    ${issue.untranslatedSample.join(', ')}`);
    }
  }
  console.log(`\n${Object.values(report).reduce((n, ns) => n + Object.keys(ns).length, 0)} namespace(s) with issues across ${locales.length} locale(s).`);
  process.exit(1);
}

main();
