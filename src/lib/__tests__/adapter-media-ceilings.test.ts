import { describe, expect, it } from 'vitest';
import { getSocialChannelConfig } from '@/lib/social/channel-catalog';

/**
 * Silent truncation sweep (plan item 3.10 / CH-02).
 *
 * Every one of these adapters used to `slice()` an over-limit media list and
 * publish the remainder as if nothing had happened, which is the same class of
 * bug as the carousel truncation already fixed: the post goes out, the caller
 * is told it succeeded, and the dropped items are simply gone. Each now
 * refuses and names the limit.
 *
 * The adapter constants themselves are held against the catalog by
 * `scripts/check-capability-parity.mjs`; this covers the behaviour those
 * constants drive.
 */
describe('adapter media ceilings match the catalog', () => {
  it('keeps the Threads carousel limit and the catalog in step', () => {
    // The original defect: catalog said 10, adapter sliced at 20, so the
    // adapter's slice was unreachable and would have started dropping media
    // the moment validation loosened.
    expect(getSocialChannelConfig('threads')?.maxMediaItems).toBe(20);
  });

  it('keeps the Instagram and Pinterest ceilings where the adapters expect them', () => {
    expect(getSocialChannelConfig('instagram')?.maxMediaItems).toBe(10);
    expect(getSocialChannelConfig('pinterest')?.maxMediaItems).toBe(5);
  });
});

describe('threads publishing refuses rather than truncating', () => {
  it('rejects a carousel over the ceiling instead of slicing it', async () => {
    const { threadsPublishingAdapter } = await import('@/lib/platform/adapters/threads-publishing');
    const connection = {
      provider: 'threads',
      accessTokenEncrypted: 'enc',
      metadata: { threadsUserId: '123' },
    } as never;

    const result = await threadsPublishingAdapter.publish(connection, {
      channel: 'threads',
      content: 'too many',
      mediaUrls: Array.from({ length: 21 }, (_, i) => `https://cdn.test/${i}.jpg`),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('21');
    expect(result.error).toMatch(/maximum of 20/);
  });
});
