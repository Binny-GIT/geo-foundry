import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** shadcn's standard class-merge helper: clsx for conditional classes, twMerge to resolve Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
