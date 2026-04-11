/**
 * Firestore helpers for the slideshow domain.
 *
 * Collection layout:
 *   workspaces/{workspaceId}/slideshows/{slideshowId}
 *   workspaces/{workspaceId}/slideshows/{slideshowId}/slides/{slideId}
 *
 * All write paths should go through serializeSlideshowDoc / serializeSlideDoc
 * to guarantee a consistent shape and default values.
 */
import { adminDb } from '@/lib/firebase-admin';
import type { SlideDoc, SlideshowDoc } from './types';

export function workspaceSlideshowsCollection(workspaceId: string) {
  return adminDb.collection(`workspaces/${workspaceId}/slideshows`);
}

export function slideshowDoc(workspaceId: string, slideshowId: string) {
  return workspaceSlideshowsCollection(workspaceId).doc(slideshowId);
}

export function slideshowSlidesCollection(workspaceId: string, slideshowId: string) {
  return slideshowDoc(workspaceId, slideshowId).collection('slides');
}

export function serializeSlideshowDoc(
  id: string,
  data: Partial<SlideshowDoc> & Pick<SlideshowDoc, 'workspaceId' | 'productId' | 'prompt' | 'createdBy'>,
): SlideshowDoc {
  const now = data.updatedAt || data.createdAt || new Date().toISOString();
  return {
    id,
    workspaceId: data.workspaceId,
    productId: data.productId,
    title: data.title || '',
    prompt: data.prompt,
    channel: data.channel || 'tiktok',
    status: data.status || 'draft',
    renderMode: data.renderMode || 'carousel_images',
    renderStatus: data.renderStatus || 'not_started',
    aspectRatio: '9:16',
    slideCount: data.slideCount || 6,
    caption: data.caption || '',
    coverSlideIndex: data.coverSlideIndex || 0,
    visualStyle: data.visualStyle || 'reelfarm',
    imageStyle: data.imageStyle || 'branded',
    imageProvider: data.imageProvider || 'gemini',
    generationVersion: data.generationVersion || 1,
    exportPostId: data.exportPostId || null,
    errorMessage: data.errorMessage || null,
    createdBy: data.createdBy,
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
}

export function serializeSlideDoc(id: string, data: Partial<SlideDoc> & Pick<SlideDoc, 'index' | 'kind' | 'headline' | 'imagePrompt' | 'visualIntent'>): SlideDoc {
  const now = data.updatedAt || data.createdAt || new Date().toISOString();
  return {
    id,
    index: data.index,
    kind: data.kind,
    headline: data.headline,
    body: data.body || '',
    cta: data.cta || '',
    imagePrompt: data.imagePrompt,
    imageUrl: data.imageUrl || '',
    imageStatus: data.imageStatus || 'pending',
    visualIntent: data.visualIntent,
    quality: data.quality,
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
}
