export {}

declare module "node:stream/web" {
  interface UnderlyingDefaultSource<R = unknown> {
    readonly cancel?: (reason?: unknown) => PromiseLike<void> | void
    readonly pull?: (controller: unknown) => PromiseLike<void> | void
    readonly start?: (controller: unknown) => PromiseLike<void> | void
    readonly type?: undefined
  }
}
