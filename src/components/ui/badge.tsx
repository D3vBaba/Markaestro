import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border border-transparent px-1.5 py-0.5 text-[11.5px] leading-4 font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:ring-[3px] focus-visible:ring-ring/40 transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-muted text-mk-ink-80",
        accent: "bg-mk-accent-soft text-mk-accent",
        positive: "bg-mk-pos-soft text-mk-pos",
        negative: "bg-mk-neg-soft text-mk-neg",
        warning: "bg-mk-warn-soft text-mk-warn",
        destructive: "bg-mk-neg-soft text-mk-neg",
        outline: "border-border text-mk-ink-80 bg-card",
        ghost: "text-muted-foreground",
        link: "text-mk-accent underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

function Badge({
  className,
  variant = "secondary",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
