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
          "w-full appearance-none rounded-md border border-input bg-transparent pr-8 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          size === "sm" ? "h-8 px-2 text-xs" : "h-9 px-3",
          className,
        )}
        {...props}
      />
      <ChevronDown className={cn(
        "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground",
        size === "sm" ? "h-3 w-3" : "h-4 w-4",
      )} />
    </div>
  );
}
