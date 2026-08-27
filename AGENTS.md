<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Copy and iconography rules

- No em dashes (U+2014) anywhere a user can read: UI strings in `src/messages/**`, JSX text, template strings, toasts, emails, API error messages. Use a comma, colon, period, or parentheses instead. A missing value renders as `n/a`, never a dash.
- No sparkles: no lucide `Sparkles` icon and no sparkle emoji anywhere in the app. Label features by what they do, not as magic.
- `npm run copy:check` (part of `npm run ci`) fails on either. Run it before committing copy or icon changes.
