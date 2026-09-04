import { Skeleton } from "@/components/ui/skeleton";

export function PostCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-14" />
      </div>
      {/* Media thumbnail */}
      <Skeleton className="h-32 w-full rounded-none" />
      {/* Content lines */}
      <div className="px-4 py-3 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {/* Action pills */}
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2.5">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-14" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  );
}

export default function PostGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  );
}
