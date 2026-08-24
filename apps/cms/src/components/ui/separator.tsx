"use client"

import * as SeparatorPrimitive from "@radix-ui/react-separator"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const Separator = ({
  className,
  decorative = true,
  orientation = "horizontal",
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) => (
  <SeparatorPrimitive.Root
    className={cn(
      "shrink-0 bg-slate-200",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className,
    )}
    data-slot="separator"
    decorative={decorative}
    orientation={orientation}
    {...props}
  />
)

export { Separator }
