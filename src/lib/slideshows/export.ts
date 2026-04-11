import type { CreatePost, SlideshowSlide } from '@/lib/schemas';
import type { SlideshowDoc } from './types';

// TikTok API limits — enforced at export time so we surface a clear error
// rather than a silent truncation or API rejection during publish.
const TIKTOK_CAPTION_MAX = 4000;

export function assertSlideshowExportable(
  slideshow: Pick<SlideshowDoc, 'channel' | 'status' | 'caption' | 'title' | 'coverSlideIndex'>,
  slides: SlideshowSlide[],
) {
  if (slideshow.channel !== 'tiktok') {
    throw new Error('VALIDATION_SLIDESHOW_EXPORT_CHANNEL_UNSUPPORTED');
  }

  if (!['ready', 'exported'].includes(slideshow.status)) {
    throw new Error('VALIDATION_SLIDESHOW_NOT_READY_FOR_EXPORT');
  }

  if (slides.length < 3 || slides.length > 10) {
    throw new Error('VALIDATION_SLIDESHOW_EXPORT_INVALID_SLIDE_COUNT');
  }

  // Caption length — TikTok rejects descriptions longer than 4000 chars.
  if (slideshow.caption && slideshow.caption.length > TIKTOK_CAPTION_MAX) {
    throw new Error(
      `VALIDATION_SLIDESHOW_CAPTION_TOO_LONG:${slideshow.caption.length}:${TIKTOK_CAPTION_MAX}`,
    );
  }

  // Every slide must have a successfully generated image.  A slide with
  // imageStatus 'failed' may still carry a stale imageUrl from a previous
  // generation attempt — checking imageUrl alone is not sufficient.
  const unready = slides.find(
    (slide) => !slide.imageUrl || slide.imageStatus !== 'generated',
  );
  if (unready) {
    throw new Error(`VALIDATION_SLIDESHOW_SLIDE_MISSING_IMAGE:${unready.index}`);
  }
}

export function buildExportedSlideshowPost(
  slideshow: Pick<
    SlideshowDoc,
    'id' | 'productId' | 'caption' | 'title' | 'coverSlideIndex' | 'channel' | 'status'
  >,
  slides: SlideshowSlide[],
): CreatePost {
  assertSlideshowExportable(slideshow, slides);

  // Sort defensively — slides are returned from Firestore ordered by index, but
  // the export must guarantee order regardless of caller ordering.
  const orderedSlides = [...slides].sort((a, b) => a.index - b.index);

  return {
    content: slideshow.caption,
    channel: 'tiktok',
    status: 'draft',
    scheduledAt: null,
    mediaUrls: orderedSlides.map((slide) => slide.imageUrl).filter(Boolean),
    productId: slideshow.productId,
    generatedBy: 'slideshow',
    sourceType: 'slideshow',
    slideshowId: slideshow.id,
    slideshowTitle: slideshow.title,
    slideshowSlideCount: orderedSlides.length,
    // coverSlideIndex maps to TikTok's photo_cover_index — the 0-based
    // position of the cover image within the ordered mediaUrls array.
    slideshowCoverIndex: slideshow.coverSlideIndex,
  };
}
