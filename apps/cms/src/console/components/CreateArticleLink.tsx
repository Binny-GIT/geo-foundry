import Link from "next/link"

import { cn } from "@/lib/utils"

/** Shared manual article creation entry (workbench + article list). */
export const CreateArticleLink = ({ className }: { readonly className?: string }) => (
  <Link
    className={cn(
      "gf-console-focus inline-flex h-9 items-center rounded-xl bg-[var(--console-accent)] px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[var(--console-accent-hover)]",
      className,
    )}
    href="/admin/workspace/editions/new"
  >
    新建文章
  </Link>
)
