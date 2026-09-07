/** AI 对话的前端纯逻辑：回复解析与正文分块，供 ContentEditionAiChat 与单测共用。 */

/**
 * 提案围栏：从 ```article 起始，贪婪匹配到回复末尾的闭合 ```。
 * 不能用非贪婪到第一个 ``` —— 文章内部的代码块会提前截断提案。
 */
export const ARTICLE_FENCE = /```article[ \t]*\n([\s\S]*)\n[ \t]*```[ \t]*$/

/**
 * 把助手回复拆成「说明文字 + 文章提案」。
 * 围栏未闭合（模型截断）时按普通回复整体展示，不产生提案。
 */
export const splitArticle = (reply: string): { article: string | null; message: string } => {
  const trimmed = reply.trimEnd()
  const match = ARTICLE_FENCE.exec(trimmed)
  if (match?.[1] === undefined) return { article: null, message: reply }
  const message = trimmed.slice(0, match.index).trim()
  return {
    article: match[1].trim(),
    message: message.length > 0 ? message : "已根据你的要求准备好正文。",
  }
}

/** 「插入正文」用的简易分块：# 开头两行变标题，其余按空行分段。 */
export const blocksOf = (reply: string): Record<string, unknown>[] =>
  reply
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith("#")
        ? { blockType: "heading", level: "2", text: part.replace(/^#+\s*/, "") }
        : { blockType: "paragraph", text: part },
    )
