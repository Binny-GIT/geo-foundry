"use client"

import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gfs-accent-400/60 disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
        default: "bg-gfs-accent-500 text-white hover:bg-gfs-accent-600",
        dark: "bg-[var(--theme-text)] text-white hover:bg-[var(--theme-elevation-800)]",
        secondary:
          "border border-[var(--theme-elevation-250)] bg-[var(--theme-elevation-50)] text-[var(--theme-text)] hover:border-[var(--theme-elevation-300)] hover:bg-[var(--theme-elevation-100)]",
        danger:
          "border border-[var(--theme-error-300)] bg-[var(--gf-tone-danger-bg)] text-[var(--gf-tone-danger-fg)] hover:brightness-[.97]",
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

const Button = ({ asChild = false, className, size, variant, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      {...props}
    />
  )
}

export { Button, buttonVariants }
