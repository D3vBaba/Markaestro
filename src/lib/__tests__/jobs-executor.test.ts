import { describe, expect, it } from 'vitest';
import { getPublishJobSkipReason, shouldDisableRecurringPublishJob } from '../jobs/executor';

describe('job publisher safety guards', () => {
  it('disables recurring publish_post jobs', () => {
    expect(shouldDisableRecurringPublishJob({
      type: 'publish_post',
      schedule: 'daily',
    })).toBe(true);

    expect(shouldDisableRecurringPublishJob({
      type: 'publish_post',
      schedule: 'manual',
    })).toBe(false);

    expect(shouldDisableRecurringPublishJob({
      type: 'sync_contacts',
      schedule: 'daily',
    })).toBe(false);
  });

  it('skips posts that are already publishing or terminal', () => {
    expect(getPublishJobSkipReason({ status: 'publishing' })).toBe('post is already publishing');
    expect(getPublishJobSkipReason({ status: 'published' })).toBe('post is already published');
    expect(getPublishJobSkipReason({ status: 'platform_action_required' })).toBe('post is already waiting for platform action');
    expect(getPublishJobSkipReason({ status: 'failed' })).toBeNull();
  });
});
