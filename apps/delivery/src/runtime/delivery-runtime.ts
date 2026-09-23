/*
 * 组合 @geo/runtime 原生的 resolve()/resolveSitemap() 与本包新增的
 * resolveMedia()，对外呈现成同一个 runtime 对象——createDeliveryApp({ runtime })
 * 拿到的就是这三个方法。resolve/resolveSitemap 直接透传给
 * @geo/runtime，不做任何包装；resolveMedia 见 ./media.ts。
 */
import { createRuntime, type RuntimeObjectReader, type RuntimeOptions } from "@geo/runtime"

import { createMediaResolver, type MediaRequest, type MediaResolveResult } from "./media.js"

export type DeliveryRuntime = {
  readonly resolve: ReturnType<typeof createRuntime>["resolve"]
  readonly resolveMedia: (request: MediaRequest) => Promise<MediaResolveResult>
  readonly resolveSitemap: ReturnType<typeof createRuntime>["resolveSitemap"]
}

export type DeliveryRuntimeOptions = RuntimeOptions & { readonly store: RuntimeObjectReader }

export const createDeliveryRuntime = (options: DeliveryRuntimeOptions): DeliveryRuntime => {
  const runtime = createRuntime(options)
  const media = createMediaResolver(options)
  return Object.freeze({
    resolve: runtime.resolve,
    resolveMedia: media.resolveMedia,
    resolveSitemap: runtime.resolveSitemap,
  })
}

export type { MediaRequest, MediaResolveResult } from "./media.js"
