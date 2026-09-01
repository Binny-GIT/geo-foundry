"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

import { XIcon } from "../icons"

/*
 * shadcn/ui-style dialog on Radix primitives, restyled to the Geo Foundry
 * light-surface tokens (matches the restore-draft modal already shipped in
 * ContentEditionRail). Transitions are plain CSS via Radix data-state so no
 * animation plugin is needed.
 */

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

const DialogOverlay = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-slate-950/45 transition-opacity duration-150",
      "data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
      className,
    )}
    {...props}
  />
)

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  readonly wide?: boolean
}

/* Plain slate tokens on purpose: the dialog renders inside both the admin
 * shell (Payload --theme-* variables) and the console shell (its own
 * --console-* set), so it must not depend on either variable family. */
const DialogContent = ({ children, className, wide = false, ...props }: DialogContentProps) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid max-h-[min(85dvh,52rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl transition-all duration-150",
        wide ? "max-w-2xl" : "max-w-lg",
        "data-[state=closed]:scale-[.98] data-[state=closed]:opacity-0",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="关闭"
        className="absolute right-4 top-4 flex size-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        type="button"
      >
        <XIcon size={16} strokeWidth={1.9} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
)

const dialogKickerClass = "m-0 text-xs font-extrabold uppercase tracking-[0.08em] text-indigo-600"

const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("m-0 mt-1 text-xl font-bold tracking-tight text-slate-900", className)}
    {...props}
  />
)

const DialogDescription = ({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("m-0 mt-2 text-sm leading-6 text-slate-500", className)}
    {...props}
  />
)

const dialogFooterClass = "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  dialogFooterClass,
  dialogKickerClass,
}
