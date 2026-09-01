import Link from "next/link"

import { FilePlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

/** Shared manual article creation entry (workbench + article list). */
export const CreateArticleLink = ({ className }: { readonly className?: string }) => (
  <Button asChild className={className} size="sm" type="button">
    <Link href="/admin/workspace/editions/new">
      <FilePlusIcon size={15} /> 新建文章
    </Link>
  </Button>
)
