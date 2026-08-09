"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const t = useTranslations("appCommon.pagination");

  if (totalPages <= 1) return null;

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
        {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label={t("nextPage")}
        className="h-10 w-10 sm:h-8 sm:w-8 p-0 shrink-0"
      >
        <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(totalPages)}
        disabled={page >= totalPages}
        aria-label={t("lastPage")}
        className="h-10 w-10 sm:h-8 sm:w-8 p-0 shrink-0"
      >
        <ChevronsRight className="h-4 w-4 rtl:-scale-x-100" />
      </Button>
    </div>
  );
}
