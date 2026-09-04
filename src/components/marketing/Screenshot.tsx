import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A product screenshot in a light browser frame. The frame is the only
 * decoration: no glow, no gradient, the picture does the work.
 */
export default function Screenshot({
  src,
  alt,
  width,
  height,
  priority = false,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-mk-accent/10", className)}>
      <div className="flex h-8 items-center gap-1.5 border-b border-border bg-muted/60 px-3" aria-hidden>
        <span className="size-2.5 rounded-full bg-mk-ink-20" />
        <span className="size-2.5 rounded-full bg-mk-ink-20" />
        <span className="size-2.5 rounded-full bg-mk-ink-20" />
      </div>
      <Image src={src} alt={alt} width={width} height={height} priority={priority} className={cn("block h-auto w-full", imgClassName)} />
    </div>
  );
}
