import type { CSSProperties } from "react";

export type PillTone =
  | "pos"
  | "neg"
  | "warn"
  | "accent"
  | "neutral"
  | "ink";

/**
 * Inline style for a semantic chip. Soft fill, no border: the label and the
 * hue carry the meaning.
 */
export function pillStyle(tone: PillTone): CSSProperties {
  switch (tone) {
    case "pos":
      return { background: "var(--mk-pos-soft)", color: "var(--mk-pos)" };
    case "neg":
      return { background: "var(--mk-neg-soft)", color: "var(--mk-neg)" };
    case "warn":
      return { background: "var(--mk-warn-soft)", color: "var(--mk-warn)" };
    case "accent":
      return { background: "var(--mk-accent-soft)", color: "var(--mk-accent)" };
    case "ink":
      return { background: "var(--mk-ink)", color: "var(--mk-paper)" };
    case "neutral":
    default:
      return { background: "var(--mk-panel)", color: "var(--mk-ink-60)" };
  }
}
