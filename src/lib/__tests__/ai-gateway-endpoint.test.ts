import { afterEach, describe, expect, it } from 'vitest';
import { vertexEndpoint } from '@/lib/intelligence/ai-gateway';

const target = { project: 'proj', location: 'us-central1', model: 'gemini-2.5-flash' };

afterEach(() => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_GATEWAY_ID;
  delete process.env.CLOUDFLARE_AI_GATEWAY_TOKEN;
});

describe('vertexEndpoint', () => {
  it('calls Vertex directly without a gateway id', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    const ep = vertexEndpoint(target);
    expect(ep.url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/proj/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(ep.headers).toEqual({});
  });

  it('routes through AI Gateway when account and gateway ids are set', () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_AI_GATEWAY_ID = 'markaestro';
    process.env.CLOUDFLARE_AI_GATEWAY_TOKEN = 'gw-token';
    const ep = vertexEndpoint(target);
    expect(ep.url).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct/markaestro/google-vertex-ai/v1/projects/proj/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(ep.headers['cf-aig-authorization']).toBe('Bearer gw-token');
  });
});
