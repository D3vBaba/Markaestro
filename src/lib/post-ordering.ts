/**
 * Ordering for post lists on the Posts page.
 *
 * A post's date lives in a different field depending on where it is in its
 * life: published posts have publishedAt, queued ones scheduledAt, and drafts
 * neither. Sorting on any single field therefore mis-orders the others, so
 * ordering keys off whichever one the post actually carries.
 */

export type DatedPost = {
  publishedAt?: string | null;
  scheduledAt?: string | null;
  createdAt?: string | null;
};

/** Milliseconds for the date a post is "on"; 0 when it has no usable date. */
export function postDisplayTime(post: DatedPost): number {
  const when = post.publishedAt || post.scheduledAt || post.createdAt;
  if (!when) return 0;
  const parsed = new Date(when).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Newest date first, so page 1 holds the most recent posts and paging back
 * walks into older ones. Undated posts sort last rather than jumping to the
 * front on a 0 timestamp. Returns a new array.
 */
export function sortPostsByNewestDate<T extends DatedPost>(posts: T[]): T[] {
  return [...posts].sort((a, b) => postDisplayTime(b) - postDisplayTime(a));
}
