import { blocksToMarkdown, markdownToBlocks } from "./block-markdown"

const changed = (
  next: Record<string, unknown>,
  original: Readonly<Record<string, unknown>> | undefined,
  field: "body" | "bodyMarkdown",
): boolean => {
  if (original === undefined) return Object.hasOwn(next, field)
  return JSON.stringify(next[field]) !== JSON.stringify(original[field])
}

/**
 * 文章正文写入边界：确保 bodyMarkdown（权威）与 body（编译派生）永不分叉。
 *
 * Payload 的 beforeChange.data 是合并后的完整文档，因此不能用「字段是否存在」
 * 判断本次请求改了哪份正文；必须与 originalDoc 对比：
 *
 * 1. bodyMarkdown 实际变化：Markdown 为准重建 body（两者同时变化也如此）。
 * 2. 只有 body 实际变化：legacy blocks 反生成 bodyMarkdown。
 * 3. 两者都没变化：元数据/工作流请求，不触碰正文。
 */
export const normalizeEditionBodyWrite = (
  data: Record<string, unknown>,
  originalDoc?: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const markdownChanged = changed(data, originalDoc, "bodyMarkdown")
  const bodyChanged = changed(data, originalDoc, "body")

  if (markdownChanged && typeof data["bodyMarkdown"] === "string") {
    data["body"] = markdownToBlocks(data["bodyMarkdown"])
    return data
  }
  if (bodyChanged && Array.isArray(data["body"])) {
    data["bodyMarkdown"] = blocksToMarkdown(data["body"])
  }
  return data
}
