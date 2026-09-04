# Markaestro app design system

The app surface (`src/app/(app)`, `src/components`) follows one visual system. Every page, sheet and dialog uses these rules; nothing is styled ad hoc.

## Direction

Blue and white. Light theme by default (the dark tokens exist but are not auto-applied). White cards on a faint blue `#f7faff` ground, navy ink for text, and one light azure (`--mk-accent`, #1e73f0) that is also `--primary`: primary buttons, links, focus rings, the selected nav item, the "scheduled" status, the primary chart series. Everything else stays neutral so the blue reads as the brand, not as decoration. Depth comes from 1px rules and surface steps, not shadows or gradients.

Dials: variance 4, motion 3, density 5.

## Tokens (globals.css)

| Token | Use |
| --- | --- |
| `bg-background` (`--mk-surface`) | page ground |
| `bg-card` (`--mk-paper`) | cards, sidebar, header, inputs |
| `bg-muted` (`--mk-panel`) | hover, selected rows, secondary buttons, skeletons |
| `border-border` (`--mk-rule`) | every rule and border |
| `text-foreground` (`--mk-ink`) | titles, values |
| `text-mk-ink-80` | body |
| `text-muted-foreground` (`--mk-ink-60`) | secondary text, labels |
| `text-mk-ink-40` | placeholders, disabled, icons at rest |
| `text-mk-accent` / `bg-mk-accent-soft` | links, selected, scheduled |
| `text-mk-pos` / `text-mk-neg` / `text-mk-warn` | semantic state only |

Never write `slate-*`, `blue-*`, `gray-*`, `zinc-*` or `dark:*` color classes in app code. Tokens carry both themes.

## Shape

`--radius: 0.5rem`. Controls (buttons, inputs, chips) `rounded-lg` (8px). Cards, tiles, list containers `rounded-xl` (12px). Dialogs, sheets, popovers `rounded-2xl` (16px). Small badges `rounded-md` (6px). `rounded-full` only for avatars, switches and the workspace mark.

## Type

Geist Sans, Geist Mono for figures and keys. No serif, no gradient text, no uppercase tracked labels.

| Role | Classes |
| --- | --- |
| Page title | `text-xl font-semibold tracking-tight` |
| Section title | `text-sm font-semibold` |
| Body | `text-sm text-mk-ink-80` |
| Secondary | `text-[13px] text-muted-foreground` |
| Label / meta | `.mk-label` (12px, medium, ink-60) |
| Figure | `.mk-figure` (tabular, tight), `text-2xl font-semibold` |

Headings use `text-balance`, paragraphs `text-pretty`, data `tabular-nums`.

## Layout

- Shell: sidebar 240px at `xl`, 64px icon rail at `lg`, hidden below (drawer from header + bottom tab bar). Header 56px. Main content `max-w-[1280px]` with `px-4 sm:px-6 lg:px-8`.
- Sections stack with `space-y-8`. Inside a section, related rows use `divide-y` inside one bordered container instead of many cards.
- Cards only when the content is a discrete object (a post, a brand, a stat). Forms and settings groups are bordered sections with a header row, not nested cards.
- Grids collapse explicitly: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`.
- Fixed elements respect `env(safe-area-inset-*)`. Use `h-dvh`, never `h-screen`.

## Components

- `PageHeader`: title, optional description, actions on the right (stack on mobile).
- `Section`: title row plus children; `bordered` puts children in a rounded container.
- `StatTile`: label, figure, delta, optional sparkline. Replaces ad hoc KPI markup.
- `EmptyState`: icon, title, one-line description, exactly one action.
- `Status`: solid soft chip, no dot (dot variant only inline in text).
- Buttons: `default` blue, `outline` for secondary, `ghost` for toolbar, `destructive` only inside a confirm dialog flow.

## Motion

Only `transform` and `opacity`. Press feedback `active:scale-[0.98]` 150ms ease-out. Overlays 200ms in, 150ms out. Popovers scale from their trigger. Nothing loops; nothing animates on keyboard-driven actions. `prefers-reduced-motion` collapses everything to opacity.

## Copy

No em dashes, no sparkles, no "magic". Labels name what a thing does. Empty states say what to do next. Numbers formatted through `fmtCount`; missing values render `n/a`.
