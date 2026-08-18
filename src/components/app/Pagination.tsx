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
    <div className="flex items-center justify-center gap-3 pt-6 pb-[max(env(safe-area-inset-bottom),1rem)] sm:pb-4 w-full">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(1)}
        disabled={page <= 1}
        aria-label={t("firstPage")}
        className="h-10 w-10 sm:h-8 sm:w-8 p-0 shrink-0"
      >
        <ChevronsLeft className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={t("previousPage")}
        className="h-10 w-10 sm:h-8 sm:w-8 p-0 shrink-0"
      >
        <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
      <span className="text-sm sm:text-xs text-muted-foreground tabular-nums px-2 shrink-0">
        {page} / {totalPages}{hasMore ? "+" : ""}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={nextPage}
        disabled={(page >= totalPages && !hasMore) || loadingMore}
        aria-label={t("nextPage")}
        className="h-10 w-10 sm:h-8 sm:w-8 p-0 shrink-0"
      >
        <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(totalPages)}
        disabled={page >= totalPages || hasMore || loadingMore}
        aria-label={t("lastPage")}
        className="h-10 w-10 sm:h-8 sm:w-8 p-0 shrink-0"
      >
        <ChevronsRight className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
    </div>
  );
}
