"use client"

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import type { ComponentProps, Ref } from "react"

import { cn } from "@/lib/utils"

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Escape hatch onto the actual scrolling element (Radix's Viewport), for callers that need to attach behavior — not layout — to the real scroll container. */
  readonly viewportRef?: Ref<HTMLDivElement>
}

const ScrollArea = ({ children, className, viewportRef, ...props }: ScrollAreaProps) => (
  <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
    <ScrollAreaPrimitive.Viewport
      className="size-full rounded-[inherit]"
      data-slot="scroll-area-viewport"
      ref={viewportRef}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
)

const ScrollBar = ({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    className={cn(
      "flex touch-none select-none p-px transition-colors",
      orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
      orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent",
      className,
    )}
    data-slot="scroll-area-scrollbar"
    orientation={orientation}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb
      className="relative flex-1 rounded-full bg-white/15"
      data-slot="scroll-area-thumb"
    />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
)

export { ScrollArea, ScrollBar }
