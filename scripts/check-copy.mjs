#!/usr/bin/env node
/**
 * Copy rules gate (see AGENTS.md "Copy and iconography rules").
 *
 * Fails when user-facing copy contains an em dash (U+2014) or a sparkle:
 *   - src/messages/**\/*.json: any em dash or sparkle emoji
 *   - src/**\/*.{ts,tsx}: em dash or sparkle emoji outside comments, or the
 *     lucide `Sparkles` icon
 *
 * Usage: node scripts/check-copy.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const EM_DASH = "—";
const SPARKLE = "✨";
const SKIP_DIRS = new Set(["__tests__", "node_modules"]);

const problems = [];

function stripComments(source) {
  return source
    // keep line numbers stable: block comments collapse to their newlines
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    // line comments, but not the `//` inside URLs such as https://
    .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
}

function check(file) {
  const ext = extname(file);
  if (![".json", ".ts", ".tsx"].includes(ext)) return;
  if (/\.test\.tsx?$/.test(file)) return;
  const raw = readFileSync(file, "utf8");
  const text = ext === ".json" ? raw : stripComments(raw);
  const rel = relative(process.cwd(), file);
  text.split("\n").forEach((line, index) => {
    const at = `${rel}:${index + 1}`;
    if (line.includes(EM_DASH)) problems.push(`${at}: em dash in copy`);
    if (line.includes(SPARKLE)) problems.push(`${at}: sparkle emoji`);
    if (ext !== ".json" && /(?:<Sparkles\b|\bSparkles\s*[,}].*lucide-react|lucide-react.*\bSparkles\b)/.test(line)) {
      problems.push(`${at}: lucide Sparkles icon`);
    }
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else check(path);
  }
}

walk(ROOT);

if (problems.length > 0) {
  console.error(`copy:check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nNo em dashes or sparkles in user-facing copy. See AGENTS.md.");
  process.exit(1);
}
console.log("copy:check passed");
