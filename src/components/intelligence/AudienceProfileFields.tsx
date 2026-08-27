"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import FormField from "@/components/app/FormField";
import Select from "@/components/app/Select";
import TagSelect from "@/components/app/TagSelect";
import { socialChannels, type SocialChannel } from "@/lib/schemas";
import {
  businessObjectives,
  conversionActions,
  type AudienceIntelligenceProfile,
} from "@/lib/intelligence/schemas";
import {
  brandVoiceOptions,
  contentPillarOptions,
  industryOptions,
  interestOptions,
} from "@/lib/intelligence/profile-options";

const MARKET_CODES = [
  "US", "CA", "GB", "AU", "DE", "FR", "ES", "IT", "NL", "BR",
  "MX", "JP", "KR", "IN", "AE", "SG", "NZ", "ZA", "NG", "SA",
] as const;

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function timeZones(): string[] {
  const supported = typeof Intl !== "undefined" && "supportedValuesOf" in Intl
    ? Intl.supportedValuesOf("timeZone")
    : FALLBACK_TIMEZONES;
  return supported.includes("UTC") ? supported : ["UTC", ...supported];
}

function useTagOptions(
  namespace: "pillars" | "industries" | "interests" | "voice",
  keys: readonly string[],
) {
  const t = useTranslations(`intelligence.profile.options.${namespace}`);
  return useMemo(
    () => keys.map((value) => ({
      value,
      label: t.has(value) ? t(value) : value,
    })),
    [keys, t],
  );
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function AudienceProfileFields({
  value,
  onChange,
  variant = "setup",
  disabled = false,
}: {
  value: AudienceIntelligenceProfile;
  onChange: (next: AudienceIntelligenceProfile) => void;
  variant?: "setup" | "advanced";
  disabled?: boolean;
}) {
  const t = useTranslations("intelligence.profile");
  const locale = useLocale();
  const pillarOptions = useTagOptions("pillars", contentPillarOptions);
  const industrySelectOptions = useTagOptions("industries", industryOptions);
  const interestSelectOptions = useTagOptions("interests", interestOptions);
  const voiceOptions = useTagOptions("voice", brandVoiceOptions);
  const regions = useMemo(() => {
    const display = new Intl.DisplayNames([locale], { type: "region" });
    return MARKET_CODES.map((code) => ({
      code,
      label: display.of(code) || code,
    }));
  }, [locale]);
  const zones = useMemo(() => timeZones(), []);
  const objectives = variant === "setup"
    ? businessObjectives.filter((objective) => objective !== "other")
    : businessObjectives;
  const conversions = variant === "setup"
    ? conversionActions.filter((action) => action !== "custom")
    : conversionActions;
  const primaryMarket = value.targetMarkets.find((market) => market.priority === "primary") || value.targetMarkets[0];
  const primaryPlatform = value.platformPriorities[0]?.platform || "";

  function patch(partial: Partial<AudienceIntelligenceProfile>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={t("objective")} description={t("objectiveHint")}>
          <Select
            disabled={disabled}
            value={value.objective}
            onChange={(event) => patch({ objective: event.target.value as AudienceIntelligenceProfile["objective"] })}
          >
            {objectives.map((objective) => (
              <option key={objective} value={objective}>{t(`objectives.${objective}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("primaryMarket")}>
          <Select
            disabled={disabled}
            value={primaryMarket?.code || ""}
            onChange={(event) => {
              const code = event.target.value;
              const label = regions.find((market) => market.code === code)?.label || code;
              patch({
                targetMarkets: code
                  ? [{ code, label, weight: 100, priority: "primary" }]
                  : [],
              });
            }}
          >
            <option value="">{t("marketPlaceholder")}</option>
            {regions.map((market) => (
              <option key={market.code} value={market.code}>{market.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("conversion")}>
          <Select
            disabled={disabled}
            value={value.conversionAction}
            onChange={(event) => patch({ conversionAction: event.target.value as AudienceIntelligenceProfile["conversionAction"] })}
          >
            {conversions.map((action) => (
              <option key={action} value={action}>{t(`conversions.${action}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("timezone")}>
          <Select
            disabled={disabled}
            value={value.primaryTimezone}
            onChange={(event) => patch({ primaryTimezone: event.target.value })}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label={t("platformPriority")} description={t("platformHint")}>
        <Select
          disabled={disabled}
          value={primaryPlatform}
          onChange={(event) => {
            const platform = event.target.value as SocialChannel | "";
            patch({
              platformPriorities: platform
                ? [
                  { platform, priority: 1 },
                  ...socialChannels
                    .filter((channel) => channel !== platform)
                    .map((channel, index) => ({
                      platform: channel,
                      priority: index + 2,
                    })),
                ]
                : [],
            });
          }}
        >
          <option value="">{t("platformPlaceholder")}</option>
          {socialChannels.map((channel) => (
            <option key={channel} value={channel}>{channel}</option>
          ))}
        </Select>
      </FormField>
      {variant === "advanced" && (
        <>
          <FormField label={t("pillars")} description={t("listHint")}>
            <TagSelect
              disabled={disabled}
              tags={value.contentPillars}
              options={pillarOptions}
              placeholder={t("tagEmpty.pillars")}
              addLabel={t("tagAdd")}
              max={30}
              onChange={(contentPillars) => patch({ contentPillars })}
            />
          </FormField>
          <FormField label={t("industries")} description={t("listHint")}>
            <TagSelect
              disabled={disabled}
              tags={value.industries}
              options={industrySelectOptions}
              placeholder={t("tagEmpty.industries")}
              addLabel={t("tagAdd")}
              max={30}
              onChange={(industries) => patch({ industries })}
            />
          </FormField>
          <FormField label={t("interests")} description={t("listHint")}>
            <TagSelect
              disabled={disabled}
              tags={value.interests}
              options={interestSelectOptions}
              placeholder={t("tagEmpty.interests")}
              addLabel={t("tagAdd")}
              max={50}
              onChange={(interests) => patch({ interests })}
            />
          </FormField>
          <FormField label={t("voice")} description={t("voiceHint")}>
            <TagSelect
              disabled={disabled}
              tags={value.brandVoice}
              options={voiceOptions}
              placeholder={t("tagEmpty.voice")}
              addLabel={t("tagAdd")}
              max={15}
              onChange={(brandVoice) => patch({ brandVoice })}
            />
          </FormField>
        </>
      )}
    </div>
  );
}
