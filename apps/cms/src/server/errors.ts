/*
 * 服务端领域错误：每个错误带机器码（对外契约）与 HTTP 状态映射。
 * 取代 Payload 把真实原因掩成 "Something went wrong" 的错误面——
 * 消息面向写作者可读，code 面向客户端程序判断。
 */

export class DomainError extends Error {
  override readonly name: string = "DomainError"
  readonly status: number

  constructor(
    readonly code: string,
    message: string,
    status: number,
  ) {
    super(message)
    this.status = status
  }
}

export class EntityNotFoundError extends DomainError {
  override readonly name = "EntityNotFoundError"
  constructor(entity: string, id: string | number) {
    super(`${String(entity).toUpperCase()}_NOT_FOUND`, `未找到${entity}（${String(id)}）。`, 404)
  }
}

export class TenantScopeError extends DomainError {
  override readonly name = "TenantScopeError"
  constructor() {
    super("TENANT_SCOPE_DENIED", "当前账号无权访问其他租户的数据。", 403)
  }
}

export class StaleRevisionError extends DomainError {
  override readonly name = "StaleRevisionError"
  constructor(entity: string, revision: number) {
    super(
      `${String(entity).toUpperCase()}_REVISION_CONFLICT`,
      `${entity}已被他人修改（基线版本 ${String(revision)}），请刷新后重试。`,
      409,
    )
  }
}

export class DomainValidationError extends DomainError {
  override readonly name = "DomainValidationError"
  constructor(code: string, message: string) {
    super(code, message, 400)
  }
}

export class AuthenticationError extends DomainError {
  override readonly name = "AuthenticationError"
  constructor(code = "AUTHENTICATION_FAILED", message = "登录状态已失效，请重新登录。") {
    super(code, message, 401)
  }
}

export class IdempotencyConflictError extends DomainError {
  override readonly name = "IdempotencyConflictError"
  constructor() {
    super("IDEMPOTENCY_KEY_REUSED", "幂等键已绑定到不同的请求内容。", 409)
  }
}
