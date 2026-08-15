"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet } from "@/lib/api-client";
import type {
  TikTokCreatorInfo,
  TikTokCreatorInfoFailureReason,
} from "@/lib/platform/adapters/tiktok-direct-post";
import {
  getTikTokConsentVariant,
  isPrivacyOptionDisabled,
  isTikTokPrivacyLevel,
  type TikTokDirectPostFormState,
  type TikTokMediaKind,
} from "@/lib/social/tiktok-direct-post-form";

const MUSIC_USAGE_CONFIRMATION_URL =
  "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED_CONTENT_POLICY_URL =
  "https://www.tiktok.com/legal/page/global/bc-policy/en";

export type TikTokCreatorInfoState =
  | { status: "loading" }
  | { status: "ready"; info: TikTokCreatorInfo }
  | { status: "error"; message: string; reason?: TikTokCreatorInfoFailureReason };

/**
 * The TikTok Direct Post form.
 *
 * Every control here is mandated by TikTok's Content Sharing Guidelines and
 * is driven by a live creator_info query: the privacy dropdown starts
 * unselected, interaction abilities start unchecked and grey out when the
 * account disables them, commercial disclosure starts off, and the exact
 * compliance declaration is rendered above the post button.
 *
 * @see https://developers.tiktok.com/doc/content-sharing-guidelines
 */
export default function TikTokDirectPostPanel({
  productId,
  mediaKind,
  state,
  onStateChange,
  creatorInfo,
  onCreatorInfoChange,
}: {
  productId: string;
  mediaKind: TikTokMediaKind;
  state: TikTokDirectPostFormState;
  onStateChange: (next: TikTokDirectPostFormState) => void;
  creatorInfo: TikTokCreatorInfoState;
  onCreatorInfoChange: (next: TikTokCreatorInfoState) => void;
}) {
  const t = useTranslations("content.tiktokDirectPost");
  const [reloadToken, setReloadToken] = useState(0);

  // TikTok requires the form to be built from a fresh creator_info response
  // rather than a cached one, so this refetches whenever the panel mounts or
  // the brand context changes.
  useEffect(() => {
    let cancelled = false;
    onCreatorInfoChange({ status: "loading" });

    const query = productId ? `?productId=${encodeURIComponent(productId)}` : "";
    apiGet<{
      ok: boolean;
      creatorInfo?: TikTokCreatorInfo;
      error?: string;
      reason?: TikTokCreatorInfoFailureReason;
    }>(`/api/social/tiktok/creator-info${query}`)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data.ok && res.data.creatorInfo) {
          onCreatorInfoChange({ status: "ready", info: res.data.creatorInfo });
        } else {
          onCreatorInfoChange({
            status: "error",
            message: res.data?.error || t("errors.generic"),
            reason: res.data?.reason,
          });
        }
      })
      .catch(() => {
        if (!cancelled) onCreatorInfoChange({ status: "error", message: t("errors.generic") });
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, reloadToken]);

  const patch = (next: Partial<TikTokDirectPostFormState>) => {
    onStateChange({ ...state, ...next });
  };

  if (creatorInfo.status === "loading") {
    return (
      <div className="rounded-xl border border-border/40 p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  }

  if (creatorInfo.status === "error") {
    // A posting cap or ban does not clear by asking again, so the retry
    // affordance is withheld rather than inviting the creator to burn what is
    // left of their quota. Everything else is worth another attempt.
    const retryable = creatorInfo.reason !== "posting_blocked";
    return (
      <div
        className="rounded-xl px-4 py-3 text-[13px] space-y-2"
        style={{
          background: "color-mix(in oklch, var(--mk-warn) 14%, var(--mk-paper))",
          border: "1px solid color-mix(in oklch, var(--mk-warn) 28%, var(--mk-rule))",
          color: "color-mix(in oklch, var(--mk-warn) 70%, var(--mk-ink))",
        }}
      >
        <p>{creatorInfo.message}</p>
        {retryable ? (
          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            className="underline underline-offset-2 font-medium"
          >
            {t("retry")}
          </button>
        ) : (
          <p className="opacity-80">{t("errors.postingBlockedHint")}</p>
        )}
      </div>
    );
  }

  const info = creatorInfo.info;
  const consentVariant = getTikTokConsentVariant(state);

  const handleBrandedContentChange = (checked: boolean) => {
    // Branded content cannot be private. If "Only me" was already picked,
    // clear the selection rather than silently rewriting it — TikTok requires
    // the privacy level to be a deliberate choice, so the creator re-picks.
    const clearsPrivacy = checked && state.privacyLevel === "SELF_ONLY";
    patch({
      brandedContent: checked,
      ...(clearsPrivacy ? { privacyLevel: null } : {}),
    });
  };

  return (
    <div className="rounded-xl border border-border/40 p-4 space-y-5">
      {/* Which account this publishes to — required before every post. */}
      <div className="flex items-center gap-3">
        {info.creatorAvatarUrl ? (
          <img
            src={info.creatorAvatarUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover border border-border/40"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-muted" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {info.creatorNickname || info.creatorUsername || t("unknownCreator")}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">{t("postingTo")}</p>
        </div>
      </div>

      {/* Privacy — no default value, options come from creator_info. */}
      <div className="space-y-1.5">
        <Label htmlFor="tiktok-privacy">{t("privacy.label")}</Label>
        <select
          id="tiktok-privacy"
          value={state.privacyLevel ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            patch({ privacyLevel: isTikTokPrivacyLevel(value) ? value : null });
          }}
          className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="" disabled>
            {t("privacy.placeholder")}
          </option>
          {info.privacyLevelOptions.map((option) => {
            const disabled = isPrivacyOptionDisabled(option, state);
            // TikTok can add privacy levels we have no label for; show the
            // raw value rather than dropping an option the creator is
            // entitled to pick.
            const label = isTikTokPrivacyLevel(option) ? t(`privacy.options.${option}`) : option;
            return (
              <option key={option} value={option} disabled={disabled}>
                {disabled ? `${label} — ${t("privacy.brandedContentPrivateHint")}` : label}
              </option>
            );
          })}
        </select>
        {state.brandedContent && (
          <p className="text-[11px] text-muted-foreground">
            {t("privacy.brandedContentPrivateHint")}
          </p>
        )}
      </div>

      {/* Interaction abilities — nothing checked by default; an ability the
          account has turned off is rendered greyed out and disabled. */}
      <div className="space-y-2.5">
        <Label>{t("interactions.label")}</Label>

        <InteractionCheckbox
          id="tiktok-allow-comment"
          label={t("interactions.allowComment")}
          checked={state.allowComment}
          disabled={info.commentDisabled}
          disabledHint={t("interactions.disabledByAccount")}
          onChange={(checked) => patch({ allowComment: checked })}
        />

        {mediaKind === "video" && (
          <>
            <InteractionCheckbox
              id="tiktok-allow-duet"
              label={t("interactions.allowDuet")}
              checked={state.allowDuet}
              disabled={info.duetDisabled}
              disabledHint={t("interactions.disabledByAccount")}
              onChange={(checked) => patch({ allowDuet: checked })}
            />
            <InteractionCheckbox
              id="tiktok-allow-stitch"
              label={t("interactions.allowStitch")}
              checked={state.allowStitch}
              disabled={info.stitchDisabled}
              disabledHint={t("interactions.disabledByAccount")}
              onChange={(checked) => patch({ allowStitch: checked })}
            />
          </>
        )}
      </div>

      {/* Commercial content disclosure — off by default. */}
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="tiktok-disclosure">{t("disclosure.label")}</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">{t("disclosure.description")}</p>
          </div>
          <Switch
            id="tiktok-disclosure"
            checked={state.commercialContentDisclosure}
            onCheckedChange={(checked) => {
              // Collapsing the toggle clears both labels so a hidden
              // selection can never travel with the post.
              patch(
                checked
                  ? { commercialContentDisclosure: true }
                  : { commercialContentDisclosure: false, yourBrand: false, brandedContent: false },
              );
            }}
          />
        </div>

        {state.commercialContentDisclosure && (
          <div className="space-y-2.5 ps-1 border-s border-border/40 ms-1 pl-3">
            <div className="space-y-1">
              <InteractionCheckbox
                id="tiktok-your-brand"
                label={t("disclosure.yourBrand")}
                checked={state.yourBrand}
                onChange={(checked) => patch({ yourBrand: checked })}
              />
              {state.yourBrand && (
                <p className="text-[11px] text-muted-foreground ps-6">
                  {t("disclosure.yourBrandNotice")}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <InteractionCheckbox
                id="tiktok-branded-content"
                label={t("disclosure.brandedContent")}
                checked={state.brandedContent}
                onChange={handleBrandedContentChange}
              />
              {state.brandedContent && (
                <p className="text-[11px] text-muted-foreground ps-6">
                  {t("disclosure.brandedContentNotice")}
                </p>
              )}
            </div>

            {!state.yourBrand && !state.brandedContent && (
              <p className="text-[11px]" style={{ color: "var(--mk-warn)" }}>
                {t("disclosure.selectionRequired")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Compliance declaration — exact wording required by TikTok. */}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {consentVariant === "brandedContent" ? (
          t.rich("consent.brandedContent", {
            music: (chunks) => <ConsentLink href={MUSIC_USAGE_CONFIRMATION_URL}>{chunks}</ConsentLink>,
            branded: (chunks) => <ConsentLink href={BRANDED_CONTENT_POLICY_URL}>{chunks}</ConsentLink>,
          })
        ) : (
          t.rich("consent.default", {
            music: (chunks) => <ConsentLink href={MUSIC_USAGE_CONFIRMATION_URL}>{chunks}</ConsentLink>,
          })
        )}
      </p>

      <p className="text-[11px] text-muted-foreground">{t("processingNotice")}</p>

      {info.maxVideoPostDurationSec !== null && mediaKind === "video" && (
        <p className="text-[11px] text-muted-foreground">
          {t("maxDuration", { seconds: info.maxVideoPostDurationSec })}
        </p>
      )}
    </div>
  );
}

function ConsentLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  );
}

function InteractionCheckbox({
  id,
  label,
  checked,
  disabled,
  disabledHint,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onChange: (checked: boolean) => void;
}) {
  const row = (
    <div className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <Checkbox
        id={id}
        checked={disabled ? false : checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id} className={`text-[13px] font-normal ${disabled ? "cursor-not-allowed" : ""}`}>
        {label}
      </Label>
    </div>
  );

  if (!disabled || !disabledHint) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">{row}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledHint}</TooltipContent>
    </Tooltip>
  );
}
