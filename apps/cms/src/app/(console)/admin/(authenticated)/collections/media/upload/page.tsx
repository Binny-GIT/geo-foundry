import { notFound } from "next/navigation"

import { CMS_ACTION, CMS_RESOURCE } from "@/access/policy"
import { ConsoleMediaUploadForm } from "@/console/components/ConsoleMediaUploadForm"
import { canConsole, requireConsoleSession } from "@/console/lib/session.server"

const ConsoleMediaUploadPage = async () => {
  const session = await requireConsoleSession("/admin/collections/media/upload")
  if (!canConsole(session, CMS_RESOURCE.MEDIA, CMS_ACTION.CREATE)) notFound()

  return (
    <div className="grid gap-6">
      <header>
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-indigo-600">媒体库</p>
        <h1 className="m-0 pt-1 text-3xl font-semibold tracking-tight text-[var(--console-ink)]">上传媒体</h1>
        <p className="m-0 pt-2 text-sm leading-6 text-[var(--console-ink-muted)]">
          上传会直接交给 Payload 的媒体 collection。租户前缀、MIME、文件大小与稳定媒体路径均由服务端策略控制。
        </p>
      </header>
      <section className="gf-console-card p-5 sm:p-6">
        <ConsoleMediaUploadForm />
      </section>
    </div>
  )
}

export default ConsoleMediaUploadPage
