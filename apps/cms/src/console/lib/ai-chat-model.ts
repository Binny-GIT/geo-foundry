/** AI 对话的前端纯逻辑：回复解析、提案应用与草稿上下文，供组件与单测共用。 */

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

/* 发给服务端的未保存正文上限：超长截断而不是拒绝，避免长文写作时上下文丢失。 */
export const DRAFT_MARKDOWN_LIMIT = 20000

/** 未保存编辑内容的上下文快照：AI 优先读这份，而不是数据库里的旧稿。 */
export const buildDraftContext = (input: {
  readonly markdown: string
  readonly summary: string
  readonly title: string
}): { markdown: string; summary: string; title: string } => ({
  markdown:
    input.markdown.length > DRAFT_MARKDOWN_LIMIT
      ? input.markdown.slice(0, DRAFT_MARKDOWN_LIMIT)
      : input.markdown,
  summary: input.summary.slice(0, 600),
  title: input.title.slice(0, 200),
})

/** 编辑器正文里的选区快照；应用「替换选中」提案时按 start/end 定位。 */
export type SelectionSnapshot = Readonly<{ end: number; start: number; text: string }>

export type ProposalMode = "append" | "replace" | "selection"

/**
 * 把提案应用到正文，返回应用后的全文。
 * 「替换选中」在正文已漂移（选区定位处的文字与快照不一致）时返回 null，
 * 由调用方提示用户改用其他方式，绝不盲目替换错位的内容。
 */
export const applyProposal = (
  markdown: string,
  article: string,
  mode: ProposalMode,
  selection?: SelectionSnapshot,
): string | null => {
  if (mode === "selection") {
    if (selection === undefined || selection.start >= selection.end) return null
    if (markdown.slice(selection.start, selection.end) !== selection.text) return null
    return `${markdown.slice(0, selection.start)}${article}${markdown.slice(selection.end)}`
  }
  if (mode === "replace") return article
  return markdown.length > 0 ? `${markdown}\n\n${article}` : article
}

export const CONTINUE_WRITING_PROMPT =
  "请基于当前正文续写：从结尾自然延续，保持既有人称、语气与结构，只输出新增的部分，并放进 ```article 围栏。"

const SELECTED_TEXT_LIMIT = 2000

/** 「改写选中」的指令模板：选中文本随指令一起发给模型，输出只含改写后的选段。 */
export const selectionRewritePrompt = (selected: string): string =>
  [
    "请改写下面选中的内容：保持原意，表达更清晰流畅，与上下文风格一致，只输出改写后的这一段并放进 ```article 围栏。",
    "",
    "<<<选中内容开始>>>",
    selected.length > SELECTED_TEXT_LIMIT ? selected.slice(0, SELECTED_TEXT_LIMIT) : selected,
    "<<<选中内容结束>>>",
  ].join("\n")
