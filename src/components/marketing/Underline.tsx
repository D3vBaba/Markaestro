/** Hand-drawn double stroke under a highlighted word. Decorative only. */
export default function Underline({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 18"
      preserveAspectRatio="none"
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 -bottom-2 h-3 w-full text-mk-accent ${className}`}
    >
      <path d="M3 11c40-6 90-8 214-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 15c50-4 100-5 190-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
