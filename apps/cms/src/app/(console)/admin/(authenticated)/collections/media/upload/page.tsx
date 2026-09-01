import { PageHeader } from "@/console/components/PageHeader"
import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { ConsoleMediaUploadForm } from "@/console/components/ConsoleMediaUploadForm"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const ConsoleMediaUploadPage = async () => {
  const session = await requireConsoleSession("/admin/collections/media/upload")
  if (!canConsole(session, CMS_RESOURCE.MEDIA, CMS_ACTION.CREATE)) notFound()

  return (
    <div className="grid gap-6">
      <PageHeader title="上传媒体" />
      <section className="gf-console-card p-5 sm:p-6">
        <ConsoleMediaUploadForm />
      </section>
    </div>
  )
}

export default ConsoleMediaUploadPage
