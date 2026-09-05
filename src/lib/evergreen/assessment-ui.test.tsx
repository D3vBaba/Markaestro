import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import PublishedSources from '@/app/(app)/evergreen/_components/PublishedSources';
import { rankEvergreenCandidates } from './candidates';
import SourceAssessment from '@/app/(app)/evergreen/_components/SourceAssessment';
import { evaluateEvergreenEligibility } from './eligibility';
import messages from '@/messages/en/appContent.json';
import appCommon from '@/messages/en/appCommon.json';

vi.stubGlobal('React', React);
describe('Evergreen assessment presentation', () => {
  it('shows nine views without an endorsement, keeps missing counts unknown, and attributes references', () => {
    const assessment = evaluateEvergreenEligibility({ status: 'published', publishedAt: '2020-01-01', channel: 'instagram', metrics: { views: 9 } });
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ content: messages, appCommon }}>
        <SourceAssessment assessment={assessment} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('Performance data available');
    expect(html).toContain('Reuse recommendation not evaluated');
    expect(html).not.toContain('Insufficient performance evidence');
    expect(html).toContain('Content needs review');
    expect(html).toContain('Benchmark comparison unavailable');
    expect(html).toContain('>9</dd>');
    expect(html).toContain('n/a');
    expect(html).toContain('Q2 2026');
    expect(html).toContain('https://www.socialinsider.io/social-media-benchmarks');
    expect(html).not.toContain('Worth repeating');
    expect(html).not.toContain('after at least seven days');
  });
  it('shows a populated account library before any Evergreen queue exists', () => {
    const candidates = rankEvergreenCandidates(Array.from({ length: 93 }, (_, i) => ({
      id: String(i), status: 'published', publishedAt: '2026-08-01', channel: 'instagram', content: `Published guide ${i}`,
      metrics: { views: 3608, likes: 100, comments: 5 },
    })));
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ content: messages, appCommon }}>
        <PublishedSources candidates={candidates} loading={false} failed={false} onReview={() => {}} onRetry={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('93 published posts');
    expect(html).toContain('93 with recorded metrics');
    expect(html).toContain('3,608');
    expect(html).toContain('Published guide');
    expect(html).toContain('Review for reuse');
    expect(html).toContain('Top performing');
    expect(html).toContain('Most recent');
    expect(html).toContain('All platforms');
    expect(html).toContain('93 matching posts');
    expect(html).not.toContain('Insufficient performance evidence');
    expect(html).not.toContain('Worth repeating');
    expect(html).not.toContain('role="radio"');
  });

  it('reports a failed library request instead of presenting an empty account', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ content: messages, appCommon }}>
        <PublishedSources candidates={[]} loading={false} failed={true} onReview={() => {}} onRetry={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('Published posts could not be loaded');
    expect(html).toContain('Try again');
    expect(html).not.toContain('No published posts match');
  });

});
