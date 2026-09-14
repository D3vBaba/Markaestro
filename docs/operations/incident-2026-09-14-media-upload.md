# Media upload quota incident, September 14, 2026

Resolved in production by repairing the missing workspace subscription document. No application deployment required.

## Evidence

The affected member of `workspaces/default` had 11 pending upload sessions on September 14. PNG uploads and a 19,308,361-byte MOV reached the finalization step. Cloud Run request logs show successful `create-upload-url` calls followed by HTTP 402 from `finalize-upload`, including at 15:23:01 and 15:25:01 UTC. The finalization route returns that status when storage reservation rejects the upload.

The workspace storage counter was 1,954,617,141 bytes. `subscriptions/default` was absent, so the member resolved to the deployed free plan's 1 GiB storage cap. The workspace creator had an existing active Business subscription under the legacy `subscriptions/{ownerUid}` key and a separate account entitlement. Those records did not grant this member the workspace plan.

## Repair

A Firestore transaction copied the legacy owner subscription to `subscriptions/default`, preserving the existing tier, status, subscription identifier, and period end, and adding `workspaceId`, migration provenance, and timestamps. The transaction verified workspace creation ownership and owner membership and refused to overwrite an existing target. The legacy source and account entitlements were preserved. No Stripe subscription or payment was created or changed.

## Verification

Read back the production workspace record: active Business. A temporary read-only Vitest check invoked the application's real `getEffectiveLimits` resolver against production Firestore for the affected member. It passed: Business resolves and the reported MOV fits the allowance. Removed the temporary production-connected test afterward.

The customer should start a fresh upload because earlier signed sessions have expired. A customer browser upload has not been observed after the repair; verification covers the entitlement and quota cause, not a new end-to-end upload.

## Permanent application fix

`getSubscriptionForWorkspace` now resolves a missing canonical record through the workspace creator's legacy subscription, independently of the requesting user. This also covers workspace-only background jobs and billing callers. Existing canonical records remain authoritative, including cancellations and downgrades. An explicitly different legacy `workspaceId` is rejected. Account entitlements remain user-scoped, and role-based authorization still gates operations.

The invitation regression test accepts an invite through `acceptPendingInvite`, resolves the member's premium limits without a personal subscription, and reserves the incident's upload size above the old free cap. Additional cases cover canonical records, lower personal plans, workspace switching, cancellation, expired trials, background callers, and invalid ownership metadata.

Validation: 1,468 tests passed, 23 skipped; TypeScript, targeted ESLint, and diff whitespace checks passed. The application change has not been deployed. The earlier production data repair remains effective immediately.
