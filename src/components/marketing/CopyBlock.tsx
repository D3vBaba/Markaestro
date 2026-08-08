"use client";

/**
 * Dark code block with a copy button, for the marketing/developer surface.
 *
 * The agent pages are full of snippets people are meant to paste straight into
 * a terminal, a tool definition, or an agent's system prompt, so copying has to
 * be one click rather than a careful drag-select across a scrolling <pre>.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

type CopyBlockProps = {
  code: string;
  /** Small caption above the block, e.g. a filename or "bash". */
  label?: string;
  className?: string;
};

export default function CopyBlock({ code, label, className }: CopyBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied (insecure context, permissions policy).
      // The code is still selectable in the block, so fail quietly.
    }
  }, [code]);

  return (
    <div className={className}>
      {label && (
        <div className="mb-2 flex items-center justify-between">
          <span className="mk-eyebrow">{label}</span>
        </div>
      )}
      <div className="group relative">
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          className="absolute right-2.5 top-2.5 z-10 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-opacity"
          style={{
            background: "color-mix(in oklch, var(--mk-paper) 14%, transparent)",
            color: "color-mix(in oklch, var(--mk-paper) 85%, transparent)",
            border: "1px solid color-mix(in oklch, var(--mk-paper) 20%, transparent)",
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <pre
          className="overflow-x-auto rounded-lg p-4 pr-20 text-[12px] leading-6"
          style={{ background: "var(--mk-ink)", color: "var(--mk-paper)" }}
        >
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
