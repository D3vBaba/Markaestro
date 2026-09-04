import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Select({
  className,
  size,
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div className="relative">
      <select
        className={cn(
          "w-full appearance-none rounded-lg border border-input bg-card pe-8 text-base text-foreground transition-[border-color,box-shadow] outline-none hover:border-mk-ink-20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/25 focus-visible:ring-[3px]",
          size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3",
          className,
        )}
        {...props}
      />
      <ChevronDown className={cn(
        "pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground",
        size === "sm" ? "size-3" : "size-4",
      )} />
    </div>
  );
}
