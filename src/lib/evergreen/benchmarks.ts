/** Research references, not eligibility thresholds. Reviewed 2026-09-04.
 * Reports lack calibrated repeat-performance reliability and matched post-age
 * windows. Keep these references out of recommendation decisions.
 */
export const evergreenBenchmarkReferences = [
  { channel: 'instagram', format: 'all', percent: 0.45, formula: '(likes + comments) / followers × 100', period: 'Q2 2026', url: 'https://www.socialinsider.io/social-media-benchmarks' },
  { channel: 'facebook', format: 'all', percent: 0.13, formula: '(reactions + comments + shares) / followers × 100', period: 'Q2 2026', url: 'https://www.socialinsider.io/social-media-benchmarks' },
  { channel: 'linkedin', format: 'image', percent: 5.20, formula: '(clicks + reactions + comments + shares) / impressions × 100', period: 'Q2 2026', url: 'https://www.socialinsider.io/social-media-benchmarks/linkedin' },
  { channel: 'linkedin', format: 'text', percent: 3.95, formula: '(clicks + reactions + comments + shares) / impressions × 100', period: 'Q2 2026', url: 'https://www.socialinsider.io/social-media-benchmarks/linkedin' },
  { channel: 'linkedin', format: 'video', percent: 5.90, formula: '(clicks + reactions + comments + shares) / impressions × 100', period: 'Q2 2026', url: 'https://www.socialinsider.io/social-media-benchmarks/linkedin' },
] as const;
// X and TikTok omitted because of unresolved report/methodology discrepancies.
