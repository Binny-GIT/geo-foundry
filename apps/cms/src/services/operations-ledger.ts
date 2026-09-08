/*
 * Operations 台账的跨层共享定义：错误类型与幂等键/请求哈希派生。
 * 台账读写已迁至 server/repositories/operations-ledger.ts 与 operations.ts；
 * 这里的两个派生函数是幂等仲裁键的权威实现，会话路由与 worker 侧共用。
 */

import { createHash } from "node:crypto"

import { canonicalize } from "./edition-input-hash"

export class OperationsLedgerError extends Error {
  override readonly name = "OperationsLedgerError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

export const OPERATION_TYPE = ["generate", "evaluate", "publish", "rollback"] as const
export type OperationType = (typeof OPERATION_TYPE)[number]

export const OPERATION_STAGE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const operationUniqueKeyOf = (tenantId: number, endpoint: string, key: string): string =>
  createHash("sha256").update(`${tenantId}\n${endpoint}\n${key}`).digest("hex")

export const operationRequestHashOf = (requestPayload: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(requestPayload)))
    .digest("hex")
