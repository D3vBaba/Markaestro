import { describe, expect, it } from 'vitest';
import { channelDestinationsSchema, createPostSchema, updatePostSchema } from '../schemas';

/**
 * A post names only the channels it publishes to. Zod v4's z.record() is
 * exhaustive when keyed by an enum — it demanded an entry for every channel and
 * rejected single-channel posts with invalid_type on all the others, which broke
 * publishing outright. partialRecord is what keeps that from returning.
 */
describe('channelDestinationsSchema', () => {
  it('accepts a single channel without requiring the others', () => {
    const result = channelDestinationsSchema.safeParse({ instagram: 'ig-account-1' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ instagram: 'ig-account-1' });
  });

  it('accepts a subset of channels', () => {
    const result = channelDestinationsSchema.safeParse({
      instagram: 'ig-account-1',
      facebook: 'page-1',
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty object', () => {
    expect(channelDestinationsSchema.safeParse({}).success).toBe(true);
  });

  it('still rejects a non-string destination', () => {
    expect(channelDestinationsSchema.safeParse({ instagram: 42 }).success).toBe(false);
  });

  it('still rejects an unknown channel key', () => {
    expect(channelDestinationsSchema.safeParse({ myspace: 'nope' }).success).toBe(false);
  });
});

describe('post schemas with a single-channel destination', () => {
  const base = {
    content: 'hello',
    channel: 'instagram' as const,
    targetChannels: ['instagram' as const],
    channelDestinations: { instagram: 'ig-account-1' },
  };

  it('creates a post naming only Instagram', () => {
    const result = createPostSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.data?.channelDestinations).toEqual({ instagram: 'ig-account-1' });
  });

  it('updates a post naming only Instagram', () => {
    expect(updatePostSchema.safeParse(base).success).toBe(true);
  });
});
