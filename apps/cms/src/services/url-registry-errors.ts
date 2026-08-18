export class UrlRegistryError extends Error {
  override readonly name = "UrlRegistryError"

  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}
