import { DOMAIN_ERROR_CODE, DomainError } from "../errors.js"
import { err, ok, type DomainResult } from "../result.js"

const timezoneBrand: unique symbol = Symbol("geo.timezone")

export type ValidTimezone = Readonly<{
  readonly value: string
  readonly [timezoneBrand]: "ValidTimezone"
}>

export class InvalidTimezoneError extends DomainError {
  override readonly name = "InvalidTimezoneError"

  constructor(readonly received: unknown) {
    super(DOMAIN_ERROR_CODE.SITE_INVALID_TIMEZONE, "Timezone is not a supported IANA zone")
  }
}

/**
 * Persist only validated timezones: the input must resolve through Intl and
 * already be in canonical casing, so stored values are deterministic.
 */
export function validateTimezone(received: unknown): DomainResult<ValidTimezone> {
  if (typeof received !== "string" || received.length === 0 || received.trim() !== received) {
    return err(new InvalidTimezoneError(received))
  }
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: received }).resolvedOptions().timeZone
  } catch {
    return err(new InvalidTimezoneError(received))
  }
  if (resolved !== received) {
    return err(new InvalidTimezoneError(received))
  }
  return ok(Object.freeze({ [timezoneBrand]: "ValidTimezone" as const, value: received }))
}
