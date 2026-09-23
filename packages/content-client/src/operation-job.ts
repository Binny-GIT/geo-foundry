import { z } from "zod"

import {
  evaluateRequestSchema,
  generateRequestSchema,
  type OperationType,
  rollbackRequestSchema,
} from "./schemas.js"

/**
 * operation 队列任务契约（pg-boss，CMS 入队端与 worker 解析端共用）。
 *
 * 任务数据统一外壳：
 *   { kind: "operation", operationId, operationType, stage, tenantId,
 *     payload: { body } }
 * body 形状由 operationType 决定（publish/rollback/evaluate/generate）。
 *
 * 背景：2026-09-09 pg-boss 替换 outbox 时，CMS 入队端对 publish 发扁平
 * event payload（editionId 在 payload 顶层）、对 rollback 发拆掉 body 外壳
 * 的请求体，而 worker 一律读 payload.body，于是 Console 真实发布与回滚
 * 自始以 RELEASE_PAYLOAD_INVALID / ROLLBACK_PAYLOAD_INVALID 终态失败，
 * 潜伏两周才被发现。此后两端只允许以本文件为唯一真源。
 */

/** publish 任务 body：worker 按 editionId 编译发布；siteId 供多站扇出（批次 A2）使用。 */
export const publishRequestSchema = z
  .object({
    editionId: z.number().int().positive(),
    siteId: z.number().int().positive().optional(),
  })
  .strict()

export type PublishRequest = z.input<typeof publishRequestSchema>

export type OperationJobBody = {
  evaluate: z.input<typeof evaluateRequestSchema>
  generate: z.input<typeof generateRequestSchema>
  publish: PublishRequest
  rollback: z.input<typeof rollbackRequestSchema>
}

export const operationJobBodySchema = (operationType: OperationType) =>
  operationType === "publish"
    ? publishRequestSchema
    : operationType === "rollback"
      ? rollbackRequestSchema
      : operationType === "evaluate"
        ? evaluateRequestSchema
        : generateRequestSchema

/** payload 统一包装：所有 operation 任务必须带 body，不允许顶层散字段。 */
export const operationJobPayloadSchema = z
  .object({
    body: z.unknown(),
  })
  .strict()

export type OperationJobData<T extends OperationType = OperationType> = Readonly<{
  kind: "operation"
  operationId: string
  operationType: T
  payload: Readonly<{ body: OperationJobBody[T] }>
  stage: string
  tenantId: number
}>

/** 任务数据唯一构造入口：CMS 入队端用它产出 pg-boss send 的对象。 */
export const operationJobDataOf = <T extends OperationType>(input: {
  body: OperationJobBody[T]
  operationId: string
  operationType: T
  stage: string
  tenantId: number
}): OperationJobData<T> => ({
  kind: "operation",
  operationId: input.operationId,
  operationType: input.operationType,
  payload: { body: input.body },
  stage: input.stage,
  tenantId: input.tenantId,
})

export type OperationJobPayloadIssue = Readonly<{
  message: string
  path: readonly PropertyKey[]
}>

export type OperationJobPayloadParse<T extends OperationType = OperationType> =
  | { readonly data: OperationJobBody[T]; readonly success: true }
  | { readonly error: readonly OperationJobPayloadIssue[]; readonly success: false }

/** payload 唯一解析入口：worker 解析端使用；CMS 入队端在 send 前用它校验形状。 */
export const parseOperationJobPayload = <T extends OperationType>(
  payload: unknown,
  operationType: T,
): OperationJobPayloadParse<T> => {
  const wrapped = operationJobPayloadSchema.safeParse(payload)
  if (!wrapped.success) return { error: wrapped.error.issues, success: false }
  const parsed = operationJobBodySchema(operationType).safeParse(wrapped.data.body)
  if (!parsed.success) return { error: parsed.error.issues, success: false }
  return { data: parsed.data as OperationJobBody[T], success: true }
}

/** 与 worker 既有 issueTextOf 相同的报错格式：`path.field: message` 分号连接。 */
export const operationJobPayloadIssueText = (issues: readonly OperationJobPayloadIssue[]): string =>
  issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ")
