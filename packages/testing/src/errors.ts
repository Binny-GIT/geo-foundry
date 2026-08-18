export class TestHarnessConfigurationError extends Error {
  override readonly name = "TestHarnessConfigurationError"

  constructor(readonly code: string) {
    super(code)
  }
}
