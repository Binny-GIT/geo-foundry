"use client"

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger, dialogKickerClass } from "@/components/ui/dialog"
import { PlusIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

import { CMS_ROLE } from "@/access/roles"
import { ConsoleUserForm } from "./ConsoleUserForm"

/*
 * In-place creation for the users collection: the list page's "新建用户"
 * action opens this dialog instead of navigating to the standalone create
 * page (which stays available for deep links / no-JS). The embedded form
 * still hard-navigates to the list on success, which naturally closes the
 * dialog and shows the freshly created row.
 */
export const ConsoleCreateDialog = ({
  actorRole,
  label,
}: {
  readonly actorRole: typeof CMS_ROLE.SUPER_ADMIN | typeof CMS_ROLE.TENANT_ADMIN
  readonly label: string
}) => (
  <Dialog>
    <DialogTrigger asChild>
      <Button className="h-10 rounded-xl" type="button">
        <PlusIcon size={16} strokeWidth={2} /> 新建{label}
      </Button>
    </DialogTrigger>
    <DialogContent aria-describedby="create-dialog-desc" wide>
      <p className={dialogKickerClass}>创建记录</p>
      <DialogTitle>新建{label}</DialogTitle>
      <DialogDescription id="create-dialog-desc">
        可用角色与租户选择由当前会话决定；Payload API 仍会在服务端强制执行最终权限与租户规则。
      </DialogDescription>
      <div className="mt-5">
        <ConsoleUserForm actorRole={actorRole} />
      </div>
    </DialogContent>
  </Dialog>
)
