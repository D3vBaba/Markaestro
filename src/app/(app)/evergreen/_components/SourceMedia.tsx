"use client";
import { useTranslations } from "next-intl";
import { PostThumbnail } from "@/components/mk/PostThumbnail";

export default function SourceMedia({ urls, channel }: { urls: string[]; channel: string }) {
  const t = useTranslations("content.evergreenTab.assessment");
  if (!urls.length) return null;
  return <div className="flex flex-wrap gap-2">{urls.map((url, i) => (
    <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" aria-label={`${t("openMedia")} ${i + 1}`}>
      <PostThumbnail src={url} mediaUrl={url} channel={channel} size={64} />
    </a>
  ))}</div>;
}
