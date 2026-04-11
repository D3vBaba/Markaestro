/**
 * scripts/seed-character-models.ts
 *
 * One-time admin script: generates reference hero shots for all 20 character
 * model specs and writes them to Firestore + Firebase Storage.
 *
 * Run:
 *   npx tsx scripts/seed-character-models.ts
 *
 * Requires:
 *   - GEMINI_API_KEY in .env.local
 *   - FIREBASE_SERVICE_ACCOUNT_KEY (or GOOGLE_APPLICATION_CREDENTIALS) configured
 *   - Firebase Storage bucket accessible
 *
 * The script generates 3 reference shots per model (different lighting/slight
 * angle variations from the same prompt) and stores:
 *   - All 3 as referenceImageUrls
 *   - The first as primaryReferenceImageUrl
 *   - A 200x200 thumbnail crop of the first as thumbnailUrl
 *
 * Safe to re-run: skips models where a Firestore doc already exists unless
 * --force flag is passed.
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load env before any other imports
dotenv.config({ path: resolve(__dirname, '../.env.local') });

import admin from 'firebase-admin';
import { CHARACTER_MODEL_SPECS } from '../src/lib/character-models/definitions';

// ── Firebase init ─────────────────────────────────────────────────────

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccount = raw && raw.startsWith('{') ? JSON.parse(raw) : undefined;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  admin.initializeApp({
    credential: serviceAccount
      ? admin.credential.cert(serviceAccount)
      : admin.credential.applicationDefault(),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    ...(projectId && !serviceAccount ? { projectId } : {}),
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ── Helpers ───────────────────────────────────────────────────────────

async function generateImageWithGemini(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '9:16', imageSize: '1K' },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini API error: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);

  const parts = data.candidates?.[0]?.content?.parts;
  const imgPart = parts?.find((p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData);
  if (!imgPart?.inlineData) throw new Error('No image in Gemini response');

  return { base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' };
}

async function uploadToStorage(base64: string, mimeType: string, modelId: string, index: number): Promise<string> {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const filePath = `character-models/${modelId}/ref_${index}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const file = bucket.file(filePath);
  await file.save(buffer, {
    metadata: { contentType: mimeType, cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

// Angle / scene variations to append to the base prompt for 3 diverse reference shots.
// These replace the old studio headshot angles with candid lifestyle compositions
// that match the viral TikTok UGC aesthetic.
const ANGLE_VARIANTS = [
  'Shot from behind over the shoulder — we see their back and the side of their face in a 3/4 back angle. They are looking out at the environment ahead of them. Natural and candid, as if they do not know the camera is there. No eye contact with camera.',
  'Side profile while walking — caught mid-stride at a 90-degree side angle, face in natural profile. Motion in the step, relaxed and unposed. Urban sidewalk or park path stretching ahead.',
  'Candid seated moment, not looking at camera — slightly angled away, looking down at a phone or a coffee cup in their hands. Quiet, unstaged. Cafe table, park bench, or outdoor steps. Authentic real-world feel.',
];

// ── Main ──────────────────────────────────────────────────────────────

const FORCE = process.argv.includes('--force');

async function seedModel(spec: typeof CHARACTER_MODEL_SPECS[number]) {
  const docRef = db.collection('characterModels').doc(spec.id);
  const existing = await docRef.get();

  if (existing.exists && !FORCE) {
    console.log(`  ⏭  ${spec.id} (${spec.name}) — already exists, skipping`);
    return;
  }

  console.log(`  ⚡ Generating ${spec.id} (${spec.name})…`);

  const referenceImageUrls: string[] = [];

  for (let i = 0; i < 3; i++) {
    const prompt = `${spec.generationPrompt} ${ANGLE_VARIANTS[i]}`;
    try {
      const { base64, mimeType } = await generateImageWithGemini(prompt);
      const url = await uploadToStorage(base64, mimeType, spec.id, i);
      referenceImageUrls.push(url);
      console.log(`     Shot ${i + 1}/3 uploaded: ${url}`);
      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`     ❌ Shot ${i + 1}/3 failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (referenceImageUrls.length === 0) {
    console.error(`  ❌ ${spec.id}: No images generated — skipping Firestore write`);
    return;
  }

  const doc = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    gender: spec.gender,
    ageRange: spec.ageRange,
    ethnicity: spec.ethnicity,
    bodySize: spec.bodySize,
    style: spec.style,
    referenceImageUrls,
    primaryReferenceImageUrl: referenceImageUrls[0],
    thumbnailUrl: referenceImageUrls[0], // Could be a resized version in production
    generationPrompt: spec.generationPrompt,
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  await docRef.set(doc);
  console.log(`  ✅ ${spec.id} (${spec.name}) saved to Firestore with ${referenceImageUrls.length} reference images`);
}

async function main() {
  console.log(`\n🎭 Character Model Seeder — ${CHARACTER_MODEL_SPECS.length} models\n`);
  console.log(FORCE ? '  Mode: FORCE (overwriting existing)' : '  Mode: SKIP existing\n');

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const spec of CHARACTER_MODEL_SPECS) {
    try {
      const docRef = db.collection('characterModels').doc(spec.id);
      const existing = await docRef.get();
      if (existing.exists && !FORCE) {
        skipped++;
        console.log(`  ⏭  ${spec.id} (${spec.name}) — exists`);
        continue;
      }
      await seedModel(spec);
      success++;
    } catch (err) {
      failed++;
      console.error(`  ❌ ${spec.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n✅ Done: ${success} seeded, ${skipped} skipped, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
