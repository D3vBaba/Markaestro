# Direct media upload rollout

Large browser uploads can bypass the Next.js/Cloud Run process and go directly
to Cloud Storage. This prevents a 250 MB video from occupying hundreds of MB of
runtime memory and a request slot. The existing multipart endpoint remains the
default and the client falls back to it during a rolling deployment.

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
