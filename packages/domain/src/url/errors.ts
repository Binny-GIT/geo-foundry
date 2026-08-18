import { DomainError, type DomainErrorCode } from "../errors.js"

export type UrlErrorCode = Extract<DomainErrorCode, `URL_${string}`>

export class UrlBoundaryError extends DomainError {
  override readonly name = "UrlBoundaryError"

  constructor(
    code: UrlErrorCode,
    message: string,
    readonly received: string,
  ) {
    super(code, message)
  }
}

export class UrlInvariantError extends DomainError {
  override readonly name = "UrlInvariantError"

  constructor(
    code: UrlErrorCode,
    message: string,
    readonly subject: string,
  ) {
    super(code, message)
  }
}
