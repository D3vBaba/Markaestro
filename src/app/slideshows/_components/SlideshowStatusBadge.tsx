type Config = { dot: string; label: string };

const statusConfig: Record<string, Config> = {
  draft: { dot: 'bg-zinc-300', label: 'Draft' },
  researching: { dot: 'bg-blue-400 animate-pulse', label: 'Researching' },
  generating_slides: { dot: 'bg-blue-400 animate-pulse', label: 'Generating' },
  generating_images: { dot: 'bg-blue-400 animate-pulse', label: 'Generating Images' },
  ready: { dot: 'bg-emerald-500', label: 'Ready' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
  exported: { dot: 'bg-violet-500', label: 'Exported' },
};

export default function SlideshowStatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { dot: 'bg-zinc-300', label: status };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
      <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
        {cfg.label}
      </span>
    </span>
  );
}
