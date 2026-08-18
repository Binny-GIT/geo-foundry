import { UnreachableStateError } from "./errors.js"

export function assertNever(value: never): never {
  void value
  throw new UnreachableStateError()
}
