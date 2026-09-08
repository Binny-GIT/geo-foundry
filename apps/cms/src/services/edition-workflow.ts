/*
 * 工作流领域错误。状态机实现已迁至 server/repositories/edition-workflow.ts；
 * 这里只保留跨层共享的错误类型（internal guards 依此映射 HTTP 状态码）。
 */

export class EditionWorkflowError extends Error {
  override readonly name = "EditionWorkflowError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}
