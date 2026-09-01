"use client"

import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400/60 disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-4 py-2",
        icon: "size-9",
        lg: "min-h-11 px-4 py-2",
        sm: "h-8 gap-1.5 rounded-md px-3",
      },
      variant: {
        /*
         * Standard Tailwind palette scales only (no --gf-* / --theme-*
         * variables): this component renders inside both the Payload admin
         * shell and the console shell, which compile two disjoint Tailwind
         * stylesheets with separate @theme token sets.
         */
        default: "bg-indigo-500 text-white hover:bg-indigo-600",
        dark: "bg-slate-900 text-white hover:bg-slate-800",
        secondary:
          "border border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100",
        danger: "border border-rose-200 bg-rose-50 text-rose-700 hover:brightness-[.97]",
        ghost: "hover:bg-white/10",
        outline: "border border-white/15 hover:bg-white/10",
      },
    },
  },
)

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    readonly asChild?: boolean
  }

/* React 19 passes `ref` as a regular prop; forward it so callers can
 * autofocus buttons rendered through this component. */
const Button = ({ asChild = false, className, ref, size, variant, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      ref={ref}
      {...props}
    />
  )
}

export { Button, buttonVariants }
