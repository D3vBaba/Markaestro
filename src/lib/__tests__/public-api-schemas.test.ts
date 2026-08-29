import { describe, it, expect } from 'vitest';
import { createPublicPostSchema, createPublicPostsBatchSchema } from '@/lib/public-api/schemas';
import {
  MAX_CAPTION_LENGTH,
  MAX_MEDIA_ITEMS,
  socialChannelCatalog,
} from '@/lib/social/channel-catalog';

describe('createPublicPostSchema brandId alias', () => {
  const base = { channel: 'instagram', caption: 'hello' };

  it('keeps productId when only productId is sent', () => {
    const parsed = createPublicPostSchema.parse({ ...base, productId: 'prod_1' });
    expect(parsed.productId).toBe('prod_1');
    expect('brandId' in parsed).toBe(false);
  });

  it('resolves brandId to productId when only brandId is sent', () => {
    const parsed = createPublicPostSchema.parse({ ...base, brandId: 'prod_2' });
    expect(parsed.productId).toBe('prod_2');
    expect('brandId' in parsed).toBe(false);
  });

  it('prefers productId when both are sent', () => {
    const parsed = createPublicPostSchema.parse({
      ...base,
      productId: 'prod_1',
      brandId: 'prod_2',
    });
    expect(parsed.productId).toBe('prod_1');
  });

  it('leaves productId undefined when neither is sent (key-scoped default)', () => {
    const parsed = createPublicPostSchema.parse(base);
    expect(parsed.productId).toBeUndefined();
  });

  it('applies the alias inside batch payloads', () => {
    const parsed = createPublicPostsBatchSchema.parse({
      posts: [
        { ...base, brandId: 'prod_3' },
        { ...base, productId: 'prod_4' },
      ],
    });
    expect(parsed.posts[0].productId).toBe('prod_3');
    expect(parsed.posts[1].productId).toBe('prod_4');
  });
});

describe('createPublicPostSchema payload bounds', () => {
  it('accepts a caption as long as the widest channel allows', () => {
    // Facebook's ceiling is 63,206. A hardcoded 4,000 here made the API 15x
    // stricter than the composer for the same account.
    const caption = 'a'.repeat(MAX_CAPTION_LENGTH);
    const parsed = createPublicPostSchema.parse({ channel: 'facebook', caption });
    expect(parsed.caption.length).toBe(MAX_CAPTION_LENGTH);
  });

  it('rejects a caption past every channel ceiling as a payload-size guard', () => {
    const caption = 'a'.repeat(MAX_CAPTION_LENGTH + 1);
    expect(() => createPublicPostSchema.parse({ channel: 'facebook', caption })).toThrow();
  });

  it('bounds the schema at the catalog maximum rather than a literal', () => {
    // Adding a longer-caption channel must widen the guard, not silently
    // truncate that channel's callers.
    const widest = Math.max(...socialChannelCatalog.map((entry) => entry.maxLength));
    expect(MAX_CAPTION_LENGTH).toBe(widest);
    expect(MAX_MEDIA_ITEMS).toBe(Math.max(...socialChannelCatalog.map((e) => e.maxMediaItems)));
  });
});

describe('the channel catalog carries no unread fields', () => {
  it('lists exactly the keys something consumes', () => {
    // `supportsScheduling` and `editor` sat here with no reader, which is how
    // `tiktok.supportsDirectPublish: false` stayed wrong after Direct Post
    // shipped. A new field has to be added here deliberately, which is the
    // moment to ask what reads it.
    const READ_FIELDS = [
      'channel',
      'label',
      'providerKeys',
      'maxLength',
      'mediaKinds',
      'mediaRequired',
      'maxMediaItems',
      'supportsDirectPublish',
      'setupHint',
    ].sort();
    for (const entry of socialChannelCatalog) {
      expect(Object.keys(entry).sort()).toEqual(READ_FIELDS);
    }
  });
});
