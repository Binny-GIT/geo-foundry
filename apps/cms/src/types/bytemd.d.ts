/*
 * bytemd 1.x ships Svelte-flavored typings that transitively import the
 * `svelte` package, which this app does not depend on. Rather than pulling
 * svelte in just for types, declare the small surface the markdown editor
 * actually uses (constructed in a useEffect, $on/$set/$destroy lifecycle).
 */

declare module "bytemd" {
  export interface BytemdImage {
    readonly alt?: string
    readonly title?: string
    readonly url: string
  }

  export interface BytemdLocale {
    readonly [key: string]: unknown
  }

  export interface BytemdEditorProps {
    readonly locale?: BytemdLocale
    readonly placeholder?: string
    readonly plugins?: readonly unknown[]
    readonly uploadImages?: (files: readonly File[]) => Promise<readonly BytemdImage[]>
    readonly value: string
  }

  export class Editor {
    constructor(options: { readonly props?: BytemdEditorProps; readonly target: HTMLElement })
    $destroy(): void
    $on(name: "change", callback: (event: CustomEvent<string>) => void): () => void
    $set(props: Partial<BytemdEditorProps>): void
  }
}

declare module "@bytemd/plugin-gfm" {
  // biome-ignore lint/style/noDefaultExport: 第三方模块本身就是默认导出
  const gfm: () => unknown
  export default gfm
}

declare module "bytemd/locales/zh_Hans.json" {
  // biome-ignore lint/style/noDefaultExport: JSON 模块只有默认导出形式
  const locale: { readonly [key: string]: unknown }
  export default locale
}
