"use client";

import { useTranslations } from "next-intl";
import { setCommonErrorMessages } from "@/lib/user-facing-errors";

/**
 * Hands the active locale's transport-error copy to `userFacingError`.
 *
 * `apiFetch` synthesises `MALFORMED_RESPONSE`, `INTERNAL_ERROR`, and
 * `REQUEST_TIMEOUT` for failures no individual screen can write copy for (a
 * 502 from Cloud Run, an HTML error page, a timeout). Every call site would
 * otherwise have to pass the same three-entry map, so it is registered once
 * here instead. Renders nothing.
 *
 * Registered during render rather than in an effect: the first request can
 * resolve before effects flush, and an English toast that corrects itself on
 * the next failure is worse than no localization at all.
 */
export function RequestErrorCopy() {
  const t = useTranslations("appCommon.requestErrors");
  setCommonErrorMessages({
    MALFORMED_RESPONSE: t("malformedResponse"),
    INTERNAL_ERROR: t("internalError"),
    REQUEST_TIMEOUT: t("timeout"),
  });
  return null;
}
