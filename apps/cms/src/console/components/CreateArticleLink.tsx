import Link from "next/link"

import { FilePlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

/** Shared manual article creation entry (workbench + article list). */
export const CreateArticleLink = ({
  className,
  size = "sm",
}: {
  readonly className?: string
  /** `md` matches the h-10 controls inside the article list filter bar. */
  readonly size?: "sm" | "md"
}) => (
  <Button asChild className={className} size={size} type="button">
    <Link href="/admin/workspace/editions/new">
      <FilePlusIcon size={15} /> 新建文章
    </Link>
  </Button>
)
