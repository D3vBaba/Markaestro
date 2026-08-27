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
 * Uses modern color-mix with srgb for crisp contrast across light & dark themes.
 */
export function pillStyle(tone: PillTone): CSSProperties {
  switch (tone) {
    case "pos":
      return {
        background: "color-mix(in srgb, var(--mk-pos) 12%, var(--mk-paper))",
        color: "var(--mk-pos)",
        border: "1px solid color-mix(in srgb, var(--mk-pos) 25%, transparent)",
      };
    case "neg":
      return {
        background: "color-mix(in srgb, var(--mk-neg) 10%, var(--mk-paper))",
        color: "var(--mk-neg)",
        border: "1px solid color-mix(in srgb, var(--mk-neg) 25%, transparent)",
      };
    case "warn":
      return {
        background: "color-mix(in srgb, var(--mk-warn) 12%, var(--mk-paper))",
        color: "var(--mk-warn)",
        border: "1px solid color-mix(in srgb, var(--mk-warn) 25%, transparent)",
      };
    case "accent":
      return {
        background: "var(--mk-accent-soft)",
        color: "var(--mk-accent)",
        border: "1px solid color-mix(in srgb, var(--mk-accent) 25%, transparent)",
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
        border: "1px solid var(--mk-rule)",
      };
  }
}

