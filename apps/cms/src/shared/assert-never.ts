export const assertNever = (value: never): never => {
  throw new TypeError(`UNREACHABLE_VARIANT:${String(value)}`)
}
