import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import SourceAssessment from '@/app/(app)/evergreen/_components/SourceAssessment';
import { evaluateEvergreenEligibility } from './eligibility';
import messages from '@/messages/en/appContent.json';

vi.stubGlobal('React', React);
describe('Evergreen assessment presentation', () => {
  it('shows nine views without an endorsement, keeps missing counts unknown, and attributes references', () => {
    const assessment = evaluateEvergreenEligibility({ status: 'published', publishedAt: '2020-01-01', channel: 'instagram', metrics: { views: 9 } });
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ content: messages }}>
        <SourceAssessment assessment={assessment} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('Insufficient performance evidence');
    expect(html).toContain('Content needs review');
    expect(html).toContain('Benchmark comparison unavailable');
    expect(html).toContain('>9</dd>');
    expect(html).toContain('n/a');
    expect(html).toContain('Q2 2026');
    expect(html).toContain('https://www.socialinsider.io/social-media-benchmarks');
    expect(html).not.toContain('Worth repeating');
    expect(html).not.toContain('after at least seven days');
  });
});
