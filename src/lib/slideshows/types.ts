import type {
  CreateSlideshow,
  SlideQuality,
  SlideVisualIntent,
  SlideshowChannel,
  SlideshowRenderMode,
  SlideshowSlide,
  SlideshowStatus,
  StoryFormat,
} from '@/lib/schemas';

export type SlideshowDoc = {
  id: string;
  workspaceId: string;
  productId: string;
  title: string;
  prompt: string;
  channel: SlideshowChannel;
  status: SlideshowStatus;
  renderMode: SlideshowRenderMode;
  renderStatus: 'not_started' | 'ready';
  aspectRatio: '9:16';
  slideCount: number;
  caption: string;
  coverSlideIndex: number;
  visualStyle: string;
  imageStyle: CreateSlideshow['imageStyle'];
  imageProvider: CreateSlideshow['imageProvider'];
  storyFormat: StoryFormat;
  characterModelId: string | null;
  generationVersion: number;
  exportPostId: string | null;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SlideDoc = SlideshowSlide & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type SlideQualityInput = {
  headline: string;
  body?: string;
  kind: SlideshowSlide['kind'];
  visualIntent?: SlideVisualIntent;
  imagePrompt?: string;
};

export type ScoredSlide = {
  quality: SlideQuality;
  visualSignature: string;
};
