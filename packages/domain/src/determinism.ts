import { InvalidHashError, InvalidInstantError } from "./errors.js"
import { err, ok, type DomainResult } from "./result.js"

const instantBrand: unique symbol = Symbol("geo.instant")
const hashBrand: unique symbol = Symbol("geo.sha256")

export type Instant = Readonly<{
  readonly value: string
  readonly [instantBrand]: "Instant"
}>

export type Sha256Hash = Readonly<{
  readonly value: string
  readonly [hashBrand]: "Sha256Hash"
}>

export interface Clock {
  now(): Instant
}

export interface Hasher {
  hash(input: string): Sha256Hash
}

export function parseInstant(value: string): DomainResult<Instant> {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return err(new InvalidInstantError(value))
  }
  return ok(Object.freeze({ [instantBrand]: "Instant" as const, value }))
}

export function parseSha256Hash(value: string): DomainResult<Sha256Hash> {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    return err(new InvalidHashError(value))
  }
  return ok(Object.freeze({ [hashBrand]: "Sha256Hash" as const, value }))
}

export function createFixedClock(value: string): Clock {
  const instant = parseInstant(value)
  if (!instant.ok) {
    throw instant.error
  }
  return Object.freeze({ now: () => instant.value })
}

export function createFixedHasher(hash: Sha256Hash): Hasher {
  return Object.freeze({ hash: (_input: string) => hash })
}
