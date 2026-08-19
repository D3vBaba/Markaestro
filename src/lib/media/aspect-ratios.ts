import type { SocialChannel } from '@/lib/schemas';

/**
 * Aspect-ratio rules for post media.
 *
 * Networks reject uploads on geometry, and the messages they return are
 * useless to the person who picked the images — Pinterest answers a carousel
 * of mixed shapes with a bare 400 "Images must have the same width/height
 * ratios". The composer therefore crops every image to one ratio before it is
 * uploaded, which makes the whole class of geometry rejection unreachable
 * instead of merely well-reported.
 *
 * Ratio is width / height throughout.
 */

export type AspectPresetId = 'square' | 'portrait45' | 'portrait23' | 'vertical916' | 'landscape1911';

export type AspectPreset = {
  id: AspectPresetId;
  /** width / height */
  ratio: number;
  /** Shown next to the ratio, e.g. "1:1". */
  label: string;
  /** Channels this shape is a native fit for, used to order the choices. */
  bestFor: readonly SocialChannel[];
};

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  {
    id: 'square',
    ratio: 1,
    label: '1:1',
    bestFor: ['facebook', 'instagram', 'threads', 'linkedin', 'pinterest'],
  },
  {
    id: 'portrait45',
    ratio: 4 / 5,
    label: '4:5',
    bestFor: ['instagram', 'facebook', 'threads', 'linkedin'],
  },
  {
    id: 'portrait23',
    ratio: 2 / 3,
    label: '2:3',
    bestFor: ['pinterest'],
  },
  {
    id: 'vertical916',
    ratio: 9 / 16,
    label: '9:16',
    bestFor: ['tiktok', 'instagram', 'pinterest'],
  },
  {
    id: 'landscape1911',
    ratio: 1.91,
    label: '1.91:1',
    bestFor: ['facebook', 'linkedin', 'threads'],
  },
] as const;

export function getAspectPreset(id: AspectPresetId): AspectPreset {
  const preset = ASPECT_PRESETS.find((entry) => entry.id === id);
  // The id type makes this unreachable; fall back to square rather than throw
  // inside a render path if a persisted value ever goes stale.
  return preset ?? ASPECT_PRESETS[0];
}

/**
 * The shape to open the cropper on for a given set of target channels.
 *
 * Ordered by how unforgiving each network is: TikTok is a full-screen vertical
 * surface, Pinterest's feed is built for 2:3, Instagram crops anything taller
 * than 4:5, and everything else reads fine as a square.
 */
export function recommendedPreset(channels: readonly SocialChannel[]): AspectPreset {
  if (channels.includes('tiktok')) return getAspectPreset('vertical916');
  if (channels.includes('pinterest')) return getAspectPreset('portrait23');
  if (channels.includes('instagram')) return getAspectPreset('portrait45');
  return getAspectPreset('square');
}

/**
 * Presets ordered for the channels in play — native fits first, the rest after,
 * so the list stays complete but leads with what suits the post.
 */
export function presetsForChannels(channels: readonly SocialChannel[]): readonly AspectPreset[] {
  if (channels.length === 0) return ASPECT_PRESETS;
  const fits = (preset: AspectPreset) => channels.some((channel) => preset.bestFor.includes(channel));
  return [...ASPECT_PRESETS].sort((a, b) => Number(fits(b)) - Number(fits(a)));
}

/**
 * Whether two ratios are close enough that a network treats them as one shape.
 *
 * Pinterest compares strictly: 941x1672 (0.5628) and 768x1376 (0.5581) look
 * identical and are still rejected, so the tolerance here is deliberately
 * tighter than the gap between those two.
 */
export function sameRatio(a: number, b: number, tolerance = 0.002): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

/** Whether every ratio in the set is the same shape. */
export function allSameRatio(ratios: readonly number[], tolerance = 0.002): boolean {
  if (ratios.length < 2) return true;
  return ratios.every((ratio) => sameRatio(ratio, ratios[0], tolerance));
}
