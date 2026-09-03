"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A Button with a one-line explanation on hover and focus.
 *
 * Channel actions (Connect, Reconnect, Unlink, Test connection) do things a
 * first-time user cannot guess from the label alone, and Meta's App Review
 * guidance asks that non-obvious UI elements be explained. The tooltip also
 * doubles as the caption when the flow is screen-recorded.
 */
export default function HintButton({
  hint,
  ...props
}: ComponentProps<typeof Button> & { hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} />
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-[260px] text-start">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
