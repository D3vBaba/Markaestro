# Evergreen eligibility and benchmark evidence

Reviewed: 2026-09-04. Implementation: manual content review with descriptive metrics and external research references.

## What qualifies today

A published source with a valid past publish date and a recognized channel is available for manual reuse. Metrics do not determine this operational eligibility. The source picker and preview share one evaluator. Missing metrics remain null, views and impressions stay separate, and observations retain their recorded capture time. Multi-channel totals are never attributed to individual channels.

Content suitability requires an owner to review every caption, media item, and link for continuing relevance, accuracy, expired offers, outdated instructions, and dependence on past events. Creation can save an unreviewed draft. Activation and resume require a recorded review; expired queues cannot resume. Caption edits invalidate the review unless the caller explicitly confirms the revised content. Active queues reject unconfirmed caption edits. Existing active queues without a review pause before generating another occurrence, using the existing pause/cancellation path. No data migration runs on deployment.

The UI separates content review, benchmark comparison availability, and evidence for a performance recommendation. An owner review confirms suitability; it does not establish performance. The previous weighted score, top-six recommendation quota, seven-day maturity condition, and any-positive-count gate have been removed. Legacy `suggested` remains false and `evidence` remains null for new assessments. Historical activation evidence stays stored but is no longer shown as an endorsement.

## Research references and their limits

[Socialinsider's quarterly report](https://www.socialinsider.io/social-media-benchmarks) and [LinkedIn report](https://www.socialinsider.io/social-media-benchmarks/linkedin) provide contextual engagement averages. The reference registry records platform, format, period, formula, value, and source. X and TikTok references are omitted because the reviewed material contains unresolved discrepancies. LinkedIn's [metric definitions](https://howto.socialinsider.io/en/articles/12107318-app-limitations-a-complete-guide) explain differences from native analytics.

[Buffer's methodology](https://buffer.com/resources/state-of-social-media-engagement-2026/) supports platform-specific metric definitions and contextual comparisons. Its reach-based medians cannot be combined with follower-based averages.

[Content Marketing Institute](https://contentmarketinginstitute.com/content-marketing-strategy/5-evergreen-content-tips-for-a-year-round-marketing-strategy) defines evergreen content through continuing usefulness. This informs the review criteria, not a numerical performance cutoff.

[Temporal engagement research](https://link.springer.com/article/10.1007/s11747-021-00785-z) finds platform-dependent persistence. It does not validate a universal seven-day eligibility rule.

[NIST's confidence-interval guidance](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm) supports handling small-sample uncertainty. A sum of engagement events divided by nonunique impressions is not a binomial sample of independent users. The implementation does not manufacture a confidence score from it.

[X automation rules](https://help.x.com/en/rules-and-policies/x-automation) restrict duplicative or substantially similar automated posts. Newly generated X occurrences and approved X review drafts use the existing manual-reminder delivery path, including when an older queue specified direct publishing. The UI explains that users must review and adapt the content. This change does not migrate already-scheduled posts from reviewed queues.

## What remains deliberately unavailable

There is no automatic recommendation and no above/below-benchmark classification yet. Public references do not provide the matched observation windows, full cohorts, or calibrated reuse reliability needed to support either claim. The UI explicitly explains this limitation; references are contextual and never silently become thresholds.

Before enabling recommendations, obtain comparable external post-level data with platform, format, account type/size, organic/paid status, exact metric definitions, and observation windows. Validate a minimum evidence rule against subsequent reuse outcomes on held-out data. Select confidence and error tolerances explicitly as product decisions. A user's own history may rank already-qualified posts but must not lower the external hurdle. Preserve the possibility of zero recommendations.

Do not introduce unvalidated 500-view, 10-action, or 10-post cutoffs, mix formulas, backdate metric captures, or interpret an owner review as statistical evidence.
