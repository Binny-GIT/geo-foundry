export class EvidenceVerificationError extends Error {
  override readonly name = "EvidenceVerificationError"

  constructor(
    readonly code: string,
    readonly paths: readonly string[],
  ) {
    super(code)
  }
}
