import { describe, expect, it } from 'vitest';
import { generatePipelineRequestSchema } from '@/lib/schemas';
import {
  expandPipelineImageTemplate,
  parsePipelinePostsModelOutput,
  type PipelinePost,
} from '@/lib/ai/pipeline-generator';

describe('parsePipelinePostsModelOutput', () => {
  it('accepts valid posts array', () => {
    const raw = JSON.stringify({
      posts: [
        { content: 'Hello', theme: 'Hook', imagePrompt: 'A rainy window' },
        { content: 'World', theme: 'CTA', imagePrompt: 'Sunset over water' },
      ],
    });
    const rows = parsePipelinePostsModelOutput(raw);
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(2);
    expect(rows![0].content).toBe('Hello');
  });

  it('rejects invalid payloads', () => {
    expect(parsePipelinePostsModelOutput('not json')).toBeNull();
    expect(parsePipelinePostsModelOutput('{}')).toBeNull();
    expect(parsePipelinePostsModelOutput(JSON.stringify({ posts: [{ content: '' }] }))).toBeNull();
  });
});

describe('generatePipelineRequestSchema', () => {
  it('requires postOutline when from_outline', () => {
    const r = generatePipelineRequestSchema.safeParse({
      productId: 'prod_1',
      postCopyMode: 'from_outline',
    });
    expect(r.success).toBe(false);
  });

  it('requires optimizeImagesForChannel when imageChannelMode is manual', () => {
    const r = generatePipelineRequestSchema.safeParse({
      productId: 'prod_1',
      imageChannelMode: 'manual',
    });
    expect(r.success).toBe(false);
  });
});

describe('expandPipelineImageTemplate', () => {
  const post: PipelinePost = {
    content: 'Caption text',
    pipelineStage: 'awareness',
    pipelineSequence: 3,
    pipelineTheme: 'Pain',
    imagePrompt: 'Scene brief',
  };

  it('replaces placeholders', () => {
    const out = expandPipelineImageTemplate(
      '{{sequence}} {{stage}} {{theme}} {{content}} {{imagePrompt}}',
      post,
    );
    expect(out).toBe('3 awareness Pain Caption text Scene brief');
  });
});
