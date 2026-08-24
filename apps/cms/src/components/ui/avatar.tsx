"use client"

import * as AvatarPrimitive from "@radix-ui/react-avatar"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const Avatar = ({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) => (
  <AvatarPrimitive.Root
    className={cn("relative flex size-9 shrink-0 overflow-hidden rounded-full", className)}
    data-slot="avatar"
    {...props}
  />
)

const AvatarImage = ({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Image>) => (
  <AvatarPrimitive.Image
    className={cn("aspect-square size-full", className)}
    data-slot="avatar-image"
    {...props}
  />
)

const AvatarFallback = ({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>) => (
  <AvatarPrimitive.Fallback
    className={cn(
      "flex size-full items-center justify-center rounded-full text-xs font-semibold",
      className,
    )}
    data-slot="avatar-fallback"
    {...props}
  />
)

export { Avatar, AvatarFallback, AvatarImage }
