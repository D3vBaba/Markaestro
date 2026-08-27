import type { SocialChannel } from '@/lib/schemas';
import { resolvePlatformCapabilities } from '@/lib/platform/capabilities';
import {
  normalizedMetricKeys,
  type NormalizedPostMetrics,
  type PlatformConnection,
} from '@/lib/platform/types';

export function connectionScopes(connection: PlatformConnection): string[] {
  const metadata = connection.metadata || {};
  const values = [
    metadata.oauthScopes,
    metadata.linkedinScopes,
    metadata.scopes,
  ];
  const out = new Set<string>();
  for (const value of values) {
    if (Array.isArray(value)) {
      value.filter((scope): scope is string => typeof scope === 'string').forEach((scope) => out.add(scope));
    } else if (typeof value === 'string') {
      value.split(/[\s,]+/).filter(Boolean).forEach((scope) => out.add(scope));
    }
  }
  return [...out];
}

/** Add explicit availability/source metadata without changing nullable values. */
export function annotateMetricAvailability(
  channel: SocialChannel,
  metrics: NormalizedPostMetrics,
  connection: PlatformConnection,
  measuredAt = new Date().toISOString(),
): NormalizedPostMetrics {
  const resolved = resolvePlatformCapabilities(channel, connectionScopes(connection));
  const availability = Object.fromEntries(normalizedMetricKeys.map((key) => {
    const value = metrics[key];
    const contract = resolved.metrics[key];
    if (value !== null) return [key, { state: 'available' as const }];
    if (contract.state === 'available') {
      return [key, { state: 'delayed' as const, reason: 'The platform did not return this metric for the current post.' }];
    }
    return [key, {
      state: contract.state,
      ...(contract.notes ? { reason: contract.notes } : {}),
      ...(contract.requiredScopes ? { requiredScopes: [...contract.requiredScopes] } : {}),
    }];
  }));
  return {
    ...metrics,
    availability,
    source: {
      provider: connection.provider,
      apiVersion: resolved.apiVersion,
      measuredAt,
    },
  };
}
