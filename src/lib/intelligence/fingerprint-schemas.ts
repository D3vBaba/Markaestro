import { z } from 'zod';

const confidenceSchema = z.number().min(0).max(1);
const evidenceSchema = z.array(z.object({
  field: z.string().max(80),
  evidence: z.string().max(300),
})).max(20);

const common = {
  schemaVersion: z.literal(1),
  topics: z.array(z.string().max(80)).max(12),
  pillar: z.string().max(120).nullable(),
  cta: z.string().max(240).nullable(),
  keywords: z.array(z.string().max(80)).max(30),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
  structure: z.array(z.string().max(120)).max(12),
  productPresence: z.boolean(),
  humanPresence: z.boolean(),
  confidence: confidenceSchema,
  evidence: evidenceSchema,
};

const textFields = {
  hook: z.string().max(500).nullable(),
  openingStyle: z.string().max(120).nullable(),
  conversationPotential: z.number().min(0).max(100),
  professionalValue: z.number().min(0).max(100),
  searchEvergreenFit: z.number().min(0).max(100),
};

export const contentFingerprintSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    ...common,
    ...textFields,
    transcript: z.string().max(30_000).nullable(),
    onScreenText: z.array(z.string().max(500)).max(100),
    durationSeconds: z.number().nonnegative().nullable(),
    aspectRatio: z.string().max(30).nullable(),
    pace: z.enum(['slow', 'moderate', 'fast', 'unknown']),
    visualSubjects: z.array(z.string().max(120)).max(20),
  }),
  z.object({
    kind: z.literal('image'),
    ...common,
    ...textFields,
    ocrText: z.array(z.string().max(500)).max(100),
    aspectRatio: z.string().max(30).nullable(),
    visualSubjects: z.array(z.string().max(120)).max(20),
    visualStyle: z.string().max(160).nullable(),
  }),
  z.object({
    kind: z.literal('text'),
    ...common,
    ...textFields,
    wordCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('caption'),
    ...common,
    ...textFields,
    wordCount: z.number().int().nonnegative(),
    hashtags: z.array(z.string().max(100)).max(50),
  }),
]);

export type ContentFingerprint = z.infer<typeof contentFingerprintSchema>;
export type ContentFingerprintKind = ContentFingerprint['kind'];

export const fingerprintRequestSchema = z.object({
  productId: z.string().min(1).max(128),
  kind: z.enum(['video', 'image', 'text', 'caption']),
  content: z.string().max(30_000).default(''),
  storageUri: z.string().regex(/^gs:\/\/[a-z0-9._-]+\/.+/i).optional(),
  mimeType: z.string().max(100).optional(),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  sourcePostId: z.string().max(200).optional(),
});

export type FingerprintRequest = z.infer<typeof fingerprintRequestSchema>;
