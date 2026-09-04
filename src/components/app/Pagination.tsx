"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  hasMore?: boolean;
  /** Returns true when the newly loaded batch contains the next visible page. */
  onLoadMore?: () => Promise<boolean>;
};

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  hasMore = false,
  onLoadMore,
}: PaginationProps) {
  const t = useTranslations("appCommon.pagination");
  const [loadingMore, setLoadingMore] = useState(false);

  if (totalPages <= 1 && !hasMore) return null;

  const nextPage = async () => {
    if (page < totalPages) {
      onPageChange(page + 1);
      return;
    }
    if (!hasMore || !onLoadMore || loadingMore) return;
    setLoadingMore(true);
    try {
      if (await onLoadMore()) onPageChange(page + 1);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex w-full items-center justify-center gap-2 pt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(1)}
        disabled={page <= 1}
        aria-label={t("firstPage")}
        className="size-9 p-0 sm:size-8"
      >
        <ChevronsLeft className="size-4 rtl:-scale-x-100" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={t("previousPage")}
        className="size-9 p-0 sm:size-8"
      >
        <ChevronLeft className="size-4 rtl:-scale-x-100" />
      </Button>
      <span className="shrink-0 px-2 text-[13px] tabular-nums text-muted-foreground">
        {page} / {totalPages}{hasMore ? "+" : ""}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={nextPage}
        disabled={(page >= totalPages && !hasMore) || loadingMore}
        aria-label={t("nextPage")}
        className="size-9 p-0 sm:size-8"
      >
        <ChevronRight className="size-4 rtl:-scale-x-100" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(totalPages)}
        disabled={page >= totalPages || hasMore || loadingMore}
        aria-label={t("lastPage")}
        className="size-9 p-0 sm:size-8"
      >
        <ChevronsRight className="size-4 rtl:-scale-x-100" />
      </Button>
    </div>
  );
}
