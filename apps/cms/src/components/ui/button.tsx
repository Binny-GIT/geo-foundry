"use client"

import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold no-underline outline-none transition-[colors,transform] duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-400/60 disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
        md: "h-10 px-3.5 py-2",
        sm: "h-8 gap-1.5 px-3 text-[13px]",
      },
      variant: {
        /*
         * Theme-aware via --gf-btn-* tokens (var fallbacks keep the Payload
         * admin tree on the standard palette): console.css redefines them per
         * light/dark theme, so secondary stays solid and readable in both.
         */
        default:
          "bg-[var(--gf-btn-primary,#6366f1)] text-white shadow-sm hover:bg-[var(--gf-btn-primary-hover,#4f46e5)]",
        dark: "bg-slate-900 text-white hover:bg-slate-800",
        secondary:
          "bg-[var(--gf-btn-secondary,#f1f5f9)] text-[var(--gf-btn-secondary-text,#0f172a)] shadow-sm hover:bg-[var(--gf-btn-secondary-hover,#e2e8f0)]",
        danger:
          "bg-[var(--gf-btn-danger,#fef2f2)] text-[var(--gf-btn-danger-text,#be123c)] shadow-sm hover:brightness-[.97]",
        ghost:
          "text-[var(--gf-btn-secondary-text,#334155)] hover:bg-[var(--gf-btn-secondary,#f1f5f9)]",
        outline:
          "border border-[var(--gf-btn-border,#e2e8f0)] text-[var(--gf-btn-secondary-text,#334155)] hover:bg-[var(--gf-btn-secondary,#f1f5f9)]",
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
