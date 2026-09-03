# Deferred Channel Expansion

Status: Internal roadmap only  
Last updated: 2026-09-03

## Boundary

YouTube and Reddit are intentionally excluded from the current implementation. They must not be added to public navigation, marketing copy, channel selectors, OAuth configuration, public API enums, SDKs, or customer documentation until a separate product and engineering approval starts the relevant roadmap phase.

The detailed architecture and compliance notes remain in `docs/design/intelligent-evergreen-and-channel-expansion.md` so future implementation starts from documented constraints instead of treating either platform as a generic feed.

## YouTube roadmap gate

Before implementation begins:

- Choose whether the first release supports general video, Shorts-oriented workflows, or both.
- Complete Google OAuth verification and any required YouTube API compliance audit.
- Define resumable upload checkpoints, processing reconciliation, quota reservation, metadata retention, and thumbnail policy.
- Decide the product policy for repeated video media and require review for high-impact metadata.
- Confirm analytics fields and retention rules against then-current official documentation.

## Reddit roadmap gate

Before implementation begins:

- Obtain approval for commercial Data API usage and complete legal review.
- Model subreddit destinations independently from account credentials.
- Fetch and enforce community rules, flair, allowed post types, rate limits, and structured submission errors.
- Define anti-spam limits, moderation-removal reconciliation, and conservative evergreen defaults.
- Confirm deletion, retention, and AI-processing obligations against then-current policy.

## Re-entry criteria

A deferred channel can move into implementation only when it has a named owner, approved scope, provider access, compliance sign-off, a current capability contract, a test account, and a release plan that keeps the channel disabled until production smoke tests pass.
