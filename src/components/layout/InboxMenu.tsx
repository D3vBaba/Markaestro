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
        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full" aria-label={t("title")}>
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t("title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          items.slice(0, 8).map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="flex cursor-pointer flex-col items-start gap-0.5 py-2.5"
              onSelect={() => {
                void markRead(item.id);
              }}
            >
              {item.href ? (
                <Link href={item.href} className="w-full space-y-0.5">
                  <span className={`block text-sm ${item.readAt ? "font-normal" : "font-semibold"}`}>{item.title}</span>
                  <span className="line-clamp-2 block text-xs text-muted-foreground">{item.body}</span>
                </Link>
              ) : (
                <>
                  <span className={`text-sm ${item.readAt ? "font-normal" : "font-semibold"}`}>{item.title}</span>
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
