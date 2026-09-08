/*
 * intake fetch 任务入队（pg-boss 版）：同名导出保持调用方不变，
 * BullMQ/Redis 依赖整体移除；同 item 稳定 singletonKey 去重。
 */
import { sendIntakeJob } from "../server/jobs/pgboss"

export const INTAKE_QUEUE_NAME = "content-intake"

export type IntakeQueueJob = Readonly<{
  intakeItemId: number
  tenantId: number
}>

export const enqueueIntakeFetchFromEnvironment = async (job: IntakeQueueJob): Promise<string> => {
  const id = await sendIntakeJob({
    intakeItemId: job.intakeItemId,
    kind: "intake",
    tenantId: job.tenantId,
  })
  return id ?? `intake-${job.intakeItemId}`
}
