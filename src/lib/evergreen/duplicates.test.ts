import { describe, expect, it } from 'vitest';
import { findDuplicateCaptions } from './duplicates';

const now = new Date('2026-09-04T00:00:00Z');

describe('findDuplicateCaptions', () => {
  it('flags captions identical to a recent published post, ignoring case, spacing and hashtags', () => {
    const matches = findDuplicateCaptions(
      ['Cold brew season starts Friday.', 'Brand new caption'],
      [
        { id: 'a', content: 'cold brew   season starts friday. #coffee', channel: 'x', publishedAt: '2026-08-20T00:00:00Z' },
        { id: 'old', content: 'Brand new caption', channel: 'x', publishedAt: '2026-05-01T00:00:00Z' },
      ],
      now,
    );
    expect(matches).toEqual([{ caption: 'Cold brew season starts Friday.', postId: 'a', channel: 'x', publishedAt: '2026-08-20T00:00:00Z' }]);
  });
});
