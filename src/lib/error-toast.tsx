"use client";

import { toast } from "sonner";
import { userFacingError, userFacingIssues } from "@/lib/user-facing-errors";

type ErrorToastOptions = {
  /** Reuse an existing toast id (e.g. one opened with toast.loading). */
  id?: string | number;
  /** Code → localized copy, same contract as userFacingError. */
  messages?: Readonly<Record<string, string>>;
};

/**
 * Render an API failure with everything the server actually said.
 *
 * A multi-channel post can fail for two unrelated reasons at once, and the
 * server already computes both ("Instagram is not ready: token expired",
 * "LinkedIn allows a maximum of 9 images"). Collapsing that into one generic
 * toast is the failure this exists to stop: the headline carries the primary
 * message and the per-issue list goes underneath, so a user fixing a
 * three-channel post is not told to guess which channel it was.
 *
 * Falls back to a plain toast when there are no issues, so the common single
 * reason case looks exactly as it did.
 */
export function toastApiError(
  error: unknown,
  fallback: string,
  options: ErrorToastOptions = {},
): void {
  const message = userFacingError(error, fallback, options.messages);
  // The headline is often the first issue verbatim; repeating it under itself
  // reads like two separate problems.
  const issues = userFacingIssues(error).filter((issue) => issue !== message);

  toast.error(message, {
    id: options.id,
    description:
      issues.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 ps-4">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : undefined,
  });
}
