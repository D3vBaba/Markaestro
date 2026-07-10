import { describe, it, expect } from 'vitest';
import { createPublicPostSchema, createPublicPostsBatchSchema } from '@/lib/public-api/schemas';

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
