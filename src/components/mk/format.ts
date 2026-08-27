export function fmtCount(n: number | null | undefined, locale?: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  if (n >= 1000) return n.toLocaleString(locale);
  return String(n);
}
