import type { Block, Field } from "payload"

import { localized, localizedFields, localizedOption } from "../collections/shared/localized-labels"

/**
 * A vendor-extension escape hatch carried through compilation
 * (packages/compiler/src/compile/blocks.ts). Almost no editor touches it, so
 * it stays collapsed by default instead of showing a raw JSON editor on
 * every single block — the field name and stored shape are unchanged.
 */
const extensionsField = (): Field => ({
  admin: { initCollapsed: true },
  fields: localizedFields([{ name: "extensions", type: "json" }]),
  label: localized("Extensions (advanced)", "扩展（高级）"),
  type: "collapsible",
})

export const PAGE_DOCUMENT_BLOCKS = [
  {
    slug: "paragraph",
    labels: { plural: localized("Paragraphs", "段落"), singular: localized("Paragraph", "段落") },
    fields: localizedFields([
      { name: "text", type: "textarea", required: true },
      extensionsField(),
    ]),
  },
  {
    slug: "heading",
    labels: { plural: localized("Headings", "标题"), singular: localized("Heading", "标题") },
    fields: localizedFields([
      {
        name: "level",
        type: "select",
        options: [
          localizedOption("2", "Heading 2", "二级标题"),
          localizedOption("3", "Heading 3", "三级标题"),
          localizedOption("4", "Heading 4", "四级标题"),
          localizedOption("5", "Heading 5", "五级标题"),
          localizedOption("6", "Heading 6", "六级标题"),
        ],
        required: true,
      },
      { name: "text", type: "text", required: true },
      extensionsField(),
    ]),
  },
  {
    slug: "image",
    labels: { plural: localized("Images", "图片"), singular: localized("Image", "图片") },
    fields: localizedFields([
      { name: "src", type: "text", required: true },
      { name: "alt", type: "text", required: true },
      { name: "caption", type: "text" },
      { name: "width", type: "number", min: 1 },
      { name: "height", type: "number", min: 1 },
      extensionsField(),
    ]),
  },
  {
    slug: "quote",
    labels: { plural: localized("Quotes", "引语"), singular: localized("Quote", "引语") },
    fields: localizedFields([
      { name: "text", type: "textarea", required: true },
      { name: "attribution", type: "text" },
      { name: "citeUrl", type: "text" },
      extensionsField(),
    ]),
  },
  {
    slug: "list",
    labels: { plural: localized("Lists", "列表"), singular: localized("List", "列表") },
    fields: localizedFields([
      {
        name: "style",
        type: "select",
        options: [
          localizedOption("ordered", "Ordered", "有序"),
          localizedOption("unordered", "Unordered", "无序"),
        ],
        required: true,
      },
      {
        name: "items",
        type: "array",
        minRows: 1,
        required: true,
        fields: [{ name: "text", type: "text", required: true }],
      },
      extensionsField(),
    ]),
  },
  {
    slug: "table",
    labels: { plural: localized("Tables", "表格"), singular: localized("Table", "表格") },
    fields: localizedFields([
      {
        name: "columns",
        type: "array",
        minRows: 1,
        required: true,
        fields: [{ name: "text", type: "text", required: true }],
      },
      {
        name: "rows",
        type: "array",
        minRows: 1,
        required: true,
        fields: [
          {
            name: "cells",
            type: "array",
            minRows: 1,
            required: true,
            fields: [{ name: "text", type: "text", required: true }],
          },
        ],
      },
      { name: "caption", type: "text" },
      extensionsField(),
    ]),
  },
  {
    slug: "faq",
    labels: { plural: localized("FAQs", "常见问题"), singular: localized("FAQ", "常见问题") },
    fields: localizedFields([
      {
        name: "items",
        type: "array",
        minRows: 1,
        required: true,
        fields: [
          { name: "question", type: "text", required: true },
          { name: "answer", type: "textarea", required: true },
        ],
      },
      extensionsField(),
    ]),
  },
  {
    slug: "callout",
    labels: { plural: localized("Callouts", "提示框"), singular: localized("Callout", "提示框") },
    fields: localizedFields([
      {
        name: "tone",
        type: "select",
        options: [
          localizedOption("info", "Information", "提示"),
          localizedOption("success", "Success", "成功"),
          localizedOption("warning", "Warning", "警告"),
          localizedOption("danger", "Danger", "危险"),
        ],
        required: true,
      },
      { name: "title", type: "text" },
      { name: "text", type: "textarea", required: true },
      extensionsField(),
    ]),
  },
  {
    slug: "code",
    labels: { plural: localized("Code", "代码"), singular: localized("Code", "代码") },
    fields: localizedFields([
      { name: "language", type: "text", required: true },
      { name: "code", type: "textarea", required: true },
      { name: "caption", type: "text" },
      extensionsField(),
    ]),
  },
  {
    slug: "video",
    labels: { plural: localized("Videos", "视频"), singular: localized("Video", "视频") },
    fields: localizedFields([
      { name: "src", type: "text", required: true },
      { name: "title", type: "text", required: true },
      { name: "poster", type: "text" },
      { name: "transcript", type: "textarea" },
      extensionsField(),
    ]),
  },
  {
    slug: "embed",
    labels: { plural: localized("Embeds", "嵌入内容"), singular: localized("Embed", "嵌入内容") },
    fields: localizedFields([
      { name: "provider", type: "text", required: true },
      { name: "url", type: "text", required: true },
      { name: "title", type: "text", required: true },
      extensionsField(),
    ]),
  },
  {
    slug: "references",
    labels: {
      plural: localized("References", "参考资料"),
      singular: localized("References", "参考资料"),
    },
    fields: localizedFields([
      {
        name: "items",
        type: "array",
        minRows: 1,
        required: true,
        fields: [
          { name: "citationId", type: "text", required: true },
          { name: "label", label: localized("Label", "标签"), type: "text", required: true },
        ],
      },
      extensionsField(),
    ]),
  },
] satisfies Block[]
