# Direct media upload rollout

Large browser and Public API uploads can bypass the Next.js/Cloud Run process
and go directly to Cloud Storage. This prevents a 250 MB video from occupying
hundreds of MB of runtime memory and a request slot. The established multipart
endpoints remain available as compatibility and rollback paths.

Production status (2026-08-18): bucket CORS, staging lifecycle, and blob-signing
IAM are configured, and the direct-upload feature flag is enabled. The steps
below remain the reference for a new environment or rollback/re-activation.

The browser uses `/api/media/create-upload-url` and
`/api/media/finalize-upload`. New Public API clients use
`/api/public/v1/media/upload-sessions` and
`/api/public/v1/media/upload-sessions/:id/finalize`. Public API multipart
`POST /api/public/v1/media` remains supported for existing clients. External
integrations should perform the signed `PUT` server-to-server; the production
bucket CORS policy intentionally allows only Markaestro browser origins.

## Production activation

1. Apply the bucket CORS policy:

   ```bash
   gcloud storage buckets update gs://markaestro-0226220726.firebasestorage.app \
     --cors-file=storage.cors.json
   ```

2. Apply the staging-object lifecycle policy. Only `_upload-staging/` is
   affected; finalized files live under `workspaces/.../uploads/`:

   ```bash
   gcloud storage buckets update gs://markaestro-0226220726.firebasestorage.app \
     --lifecycle-file=storage.lifecycle.json
   ```

3. Verify the App Hosting runtime service account can create V4 signed URLs.
   When metadata credentials cannot sign locally, grant that service account
   permission to sign blobs (normally `roles/iam.serviceAccountTokenCreator`
   on the same service account) and test the create-upload-url endpoint.

4. Set `NEXT_PUBLIC_DIRECT_MEDIA_UPLOADS_ENABLED` to `"1"` in
   `apphosting.yaml`, deploy a preview/revision, and smoke-test image, MP4, MOV,
   WebM, quota rejection, interrupted upload, and retry-finalization flows.

5. Roll out the revision. Set the flag back to `"0"` to return clients to the
   established multipart path without removing the new endpoints.

Do not enable the flag before CORS is active. Signed uploads are limited to a
single object path and content type; finalization independently checks the
stored type and exact byte size before moving the object into permanent media.

## Delivery and caching (5.9)

- Uploaded objects are token-gated and now carry `Cache-Control: private,
  max-age=3600`: the one browser holding the URL caches for a session, shared
  caches stay out. Repeat grid loads stop being origin reads.
- The worker derives a 320px thumbnail per image (`workspaces/{ws}/thumbs/`),
  and grids load that instead of the original.
- Cloud CDN, if enabled later, should front the `thumbs/` prefix only:
  thumbnails are downscaled and non-sensitive, originals stay private. This
  is a console/terraform change, not a code change; nothing in the app needs
  to know whether the CDN exists.
