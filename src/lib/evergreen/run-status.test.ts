import { describe, expect, it } from 'vitest';
import { evergreenRunStatus } from './run-status';

describe('Evergreen occurrence status', () => {
  it('shows publication and failure without waiting for performance evaluation', () => {
    expect(evergreenRunStatus({ status: 'scheduled' }, 'published')).toBe('published');
    expect(evergreenRunStatus({ status: 'scheduled' }, 'failed')).toBe('failed');
    expect(evergreenRunStatus({ status: 'needs_review' }, 'scheduled')).toBe('scheduled');
  });

  it('preserves review state when the occurrence is still a draft or unavailable', () => {
    expect(evergreenRunStatus({ status: 'needs_review' }, 'draft')).toBe('needs_review');
    expect(evergreenRunStatus({ status: 'needs_review' }, undefined)).toBe('needs_review');
  });

  it('preserves historical evaluations and explicit run outcomes', () => {
    for (const status of ['evaluated', 'skipped', 'failed'] as const) {
      expect(evergreenRunStatus({ status }, 'published')).toBe(status);
    }
  });
});
