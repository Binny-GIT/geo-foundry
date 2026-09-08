import { blocksToMarkdown, markdownToBlocks } from "./block-markdown"

/**
 * 文章正文写入边界：确保 bodyMarkdown（权威）与 body（编译派生）永不分叉。
 *
 * 优先级：
 * 1. 请求带 bodyMarkdown：始终以 Markdown 为准重建 body；即使同时带 body，
 *    也不允许调用方用第二份正文覆盖权威内容。
 * 2. legacy 调用只带 body：从 blocks 生成 bodyMarkdown。这样生成草稿、版本
 *    恢复、复制、站点变体、采集与旧脚本无需同时修改，也不会制造双事实。
 * 3. 两者都不带：这是只改元数据/工作流的请求，不触碰正文。
 */
export const normalizeEditionBodyWrite = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  if (typeof data["bodyMarkdown"] === "string") {
    data["body"] = markdownToBlocks(data["bodyMarkdown"])
    return data
  }
  if (Array.isArray(data["body"])) {
    data["bodyMarkdown"] = blocksToMarkdown(data["body"])
  }
  return data
}
