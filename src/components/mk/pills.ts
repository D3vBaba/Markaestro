import type { CSSProperties } from "react";

export type PillTone =
  | "pos"
  | "neg"
  | "warn"
  | "accent"
  | "neutral"
  | "ink";

/**
 * Inline style for a semantic pill/chip.
 * Uses color-mix to keep all shades derived from Markaestro tokens so pills
 * automatically track light/dark mode and accent changes.
 */
export function pillStyle(tone: PillTone): CSSProperties {
  switch (tone) {
    case "pos":
      return {
        background: "color-mix(in oklch, var(--mk-pos) 14%, var(--mk-paper))",
        color: "color-mix(in oklch, var(--mk-pos) 60%, var(--mk-ink))",
      };
    case "neg":
      return {
        background: "color-mix(in oklch, var(--mk-neg) 12%, var(--mk-paper))",
        color: "var(--mk-neg)",
      };
    case "warn":
      return {
        background: "color-mix(in oklch, var(--mk-warn) 18%, var(--mk-paper))",
        color: "color-mix(in oklch, var(--mk-warn) 60%, var(--mk-ink))",
      };
    case "accent":
      return {
        background: "var(--mk-accent-soft)",
        color: "var(--mk-accent)",
      };
    case "ink":
      return {
        background: "var(--mk-ink)",
        color: "var(--mk-paper)",
      };
    case "neutral":
    default:
      return {
        background: "var(--mk-panel)",
        color: "var(--mk-ink-60)",
      };
  }
}
