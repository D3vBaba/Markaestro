"use client"

import { Direction as DirectionPrimitive } from "radix-ui"

/**
 * Tells every Radix primitive in the tree (dropdown menus, dialogs, sheets,
 * selects, tooltips, ...) which way is "start" and "end" — without it,
 * align="start"/"end" and Popper positioning don't know about RTL. Imported
 * from a "use client" wrapper (matching TooltipProvider's pattern) because
 * the root layout that renders it is an async Server Component, and
 * radix-ui's client-only exports can't be pulled in there directly.
 */
export function DirectionProvider({
  dir,
  children,
}: {
  dir: "ltr" | "rtl"
  children: React.ReactNode
}) {
  return <DirectionPrimitive.Provider dir={dir}>{children}</DirectionPrimitive.Provider>
}
