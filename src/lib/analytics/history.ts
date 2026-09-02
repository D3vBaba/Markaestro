/**
 * Per-post metric history: the stage snapshots the poller stored, ordered
 * and totalled across channels, with the growth between consecutive stages.
 * Pure so it can be unit tested; the route only loads and hands over.
 */
import type { NormalizedPostMetrics } from '@/lib/platform/types';
import type { SocialChannel } from '@/lib/schemas';
import { engagementTotal, sumAcrossChannels, type MetricSnapshotDoc } from './types';

export type PostHistoryStage = {
  stageKey: string;
  capturedAt: string;
  /** Hours after publish when the snapshot was taken, null without a publish time. */
  hoursAfterPublish: number | null;
  views: number | null;
  reach: number | null;
  engagements: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** Growth since the previous stage; null on the first stage or when the metric is unreported. */
  viewsDelta: number | null;
  engagementsDelta: number | null;
  byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>;
};

function totals(byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>>) {
  return {
    views: sumAcrossChannels(byChannel, (m) => m.views),
    reach: sumAcrossChannels(byChannel, (m) => m.reach),
    engagements: sumAcrossChannels(byChannel, (m) => engagementTotal(m)),
    likes: sumAcrossChannels(byChannel, (m) => m.likes),
    comments: sumAcrossChannels(byChannel, (m) => m.comments),
    shares: sumAcrossChannels(byChannel, (m) => m.shares),
    saves: sumAcrossChannels(byChannel, (m) => m.saves),
  };
}

export function buildPostHistory(input: {
  publishedAt: string | null;
  snapshots: Array<Pick<MetricSnapshotDoc, 'stageKey' | 'capturedAt' | 'byChannel'>>;
  /** The denormalized latest metrics, appended when newer than the last snapshot. */
  latest?: { capturedAt: string; byChannel: Partial<Record<SocialChannel, NormalizedPostMetrics>> } | null;
}): PostHistoryStage[] {
  const publishedMs = input.publishedAt ? Date.parse(input.publishedAt) : Number.NaN;
  const entries = [...input.snapshots]
    .filter((snap) => typeof snap.capturedAt === 'string' && Number.isFinite(Date.parse(snap.capturedAt)))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const last = entries[entries.length - 1];
  if (input.latest && Number.isFinite(Date.parse(input.latest.capturedAt)) && (!last || input.latest.capturedAt > last.capturedAt)) {
    entries.push({ stageKey: 'latest', capturedAt: input.latest.capturedAt, byChannel: input.latest.byChannel });
  }

  let previous: ReturnType<typeof totals> | null = null;
  return entries.map((snap) => {
    const sums = totals(snap.byChannel ?? {});
    const delta = (key: 'views' | 'engagements'): number | null => (
      previous && sums[key] !== null && previous[key] !== null ? sums[key]! - previous[key]! : null
    );
    const stage: PostHistoryStage = {
      stageKey: snap.stageKey,
      capturedAt: snap.capturedAt,
      hoursAfterPublish: Number.isFinite(publishedMs)
        ? Math.max(0, Math.round((Date.parse(snap.capturedAt) - publishedMs) / 3600_000))
        : null,
      ...sums,
      viewsDelta: delta('views'),
      engagementsDelta: delta('engagements'),
      byChannel: snap.byChannel ?? {},
    };
    previous = sums;
    return stage;
  });
}
