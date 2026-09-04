"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiPatch } from "@/lib/api-client";
import { invalidateQueries, useApiQuery } from "@/hooks/useApiQuery";
import { toastApiError } from "@/lib/error-toast";

type InboxItem = {
  id: string;
  title: string;
  body: string;
  href?: string;
  readAt: string | null;
  createdAt: string;
};

export default function InboxMenu() {
  const t = useTranslations("shell.inbox");
  const query = useApiQuery<{ items: InboxItem[]; unread: number }>("/api/inbox");
  const items = query.data?.items || [];
  const unread = query.data?.unread || 0;

  async function markRead(id: string) {
    // Checked, not fire-and-forget: invalidating on a failed write refetches
    // the same unread item and silently undoes what the user just did.
    const res = await apiPatch("/api/inbox", { id, read: true });
    if (!res.ok) {
      toastApiError(res.data, t("markReadFailed"));
      return;
    }
    invalidateQueries("/api/inbox");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("title")}>
          <Bell className="size-[18px]" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute end-2 top-2 size-2 rounded-full bg-mk-accent ring-2 ring-card" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-[13px] font-semibold">{t("title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-[13px] text-muted-foreground">{t("empty")}</div>
        ) : (
          items.slice(0, 8).map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
              onSelect={() => {
                void markRead(item.id);
              }}
            >
              {item.href ? (
                <Link href={item.href} className="w-full space-y-0.5">
                  <span className={`block text-[13px] ${item.readAt ? "font-normal text-mk-ink-80" : "font-semibold text-foreground"}`}>{item.title}</span>
                  <span className="line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
                </Link>
              ) : (
                <>
                  <span className={`text-[13px] ${item.readAt ? "font-normal text-mk-ink-80" : "font-semibold text-foreground"}`}>{item.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
                </>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
