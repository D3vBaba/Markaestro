"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPut } from "@/lib/api-client";
import { toast } from "sonner";
import { userFacingError } from "@/lib/user-facing-errors";
import {
  defaultAudienceProfile,
  type AudienceIntelligenceProfile,
} from "@/lib/intelligence/schemas";
import AudienceProfileFields, { browserTimezone } from "./AudienceProfileFields";

export default function AudienceProfileEditor({
  productId,
  variant = "advanced",
}: {
  productId: string;
  variant?: "setup" | "advanced";
}) {
  const t = useTranslations("intelligence.profile");
  const [profile, setProfile] = useState<AudienceIntelligenceProfile>(() => defaultAudienceProfile({
    primaryTimezone: browserTimezone(),
  }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const response = await apiGet<{ profile: AudienceIntelligenceProfile | null }>(
        `/api/products/${productId}/intelligence-profile`,
      );
      if (cancelled) return;
      if (!response.ok) {
        setUnavailable(true);
        setLoading(false);
        return;
      }
      setProfile(defaultAudienceProfile({
        primaryTimezone: browserTimezone(),
        ...(response.data.profile || {}),
      }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function save() {
    setSaving(true);
    try {
      const response = await apiPut(`/api/products/${productId}/intelligence-profile`, profile);
      if (!response.ok) {
        toast.error(userFacingError(response.data, t("saveFailed")));
        return;
      }
      toast.success(t("saved"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    );
  }
  if (unavailable) {
    return <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{t("unavailable")}</p>;
  }

  return (
    <div className="space-y-4">
      <AudienceProfileFields value={profile} onChange={setProfile} variant={variant} />
      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={saving} className="h-10 sm:h-9">
          {saving && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
