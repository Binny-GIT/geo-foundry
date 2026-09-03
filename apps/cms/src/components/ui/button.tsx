"use client"

import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/*
 * Mirrors the official shadcn/ui v4 button (rounded-md, font-medium, 3px
 * focus ring, has-[>svg] padding) with semantic colors mapped to --gf-btn-*
 * tokens so the console light/dark themes (and the Payload admin tree via the
 * palette fallbacks) both render correctly.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border-0 text-sm font-medium whitespace-nowrap no-underline transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-400/60 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        md: "h-10 px-3.5 py-2 has-[>svg]:px-3",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
      variant: {
        default:
          "bg-[var(--gf-btn-primary,#6366f1)] text-white hover:bg-[var(--gf-btn-primary-hover,#4f46e5)]",
        destructive:
          "bg-[var(--gf-btn-destructive,#dc2626)] text-white hover:bg-[var(--gf-btn-destructive-hover,#b91c1c)] focus-visible:ring-[var(--gf-btn-destructive-ring,rgb(220_38_38_/_30%))]",
        secondary:
          "bg-[var(--gf-btn-secondary,#f1f5f9)] text-[var(--gf-btn-secondary-text,#0f172a)] hover:bg-[var(--gf-btn-secondary-hover,#e2e8f0)]",
        /* Quiet tinted danger for non-destructive warnings (failed-ops chip). */
        danger:
          "bg-[var(--gf-btn-danger,#fef2f2)] text-[var(--gf-btn-danger-text,#be123c)] hover:brightness-[.97]",
        outline:
          "border border-[var(--gf-btn-border,#e2e8f0)] shadow-xs hover:bg-[var(--gf-btn-secondary,#f1f5f9)]",
        ghost: "hover:bg-[var(--gf-btn-secondary,#f1f5f9)]",
        link: "text-[var(--gf-btn-primary,#4f46e5)] underline-offset-4 hover:underline",
        dark: "bg-slate-900 text-white hover:bg-slate-800",
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
      data-size={size}
      data-slot="button"
      data-variant={variant}
      ref={ref}
      {...props}
    />
  )
}

export { Button, buttonVariants }
