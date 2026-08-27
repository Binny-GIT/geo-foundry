const intakeId = (value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("intake item id must be a positive integer")
  }
  return value
}

/** Stable BullMQ identity for one source-fetch task. */
export const intakeJobIdOf = (intakeItemId: number): string => `intake-${intakeId(intakeItemId)}`
