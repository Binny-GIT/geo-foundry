import type { DomainError } from "./errors.js"

export type DomainResult<T, E extends DomainError = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): DomainResult<T, never> {
  return Object.freeze({ ok: true, value })
}

export function err<E extends DomainError>(error: E): DomainResult<never, E> {
  return Object.freeze({ error: Object.freeze(error), ok: false })
}
