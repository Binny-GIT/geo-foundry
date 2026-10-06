import { describe, expect, it } from "vitest"

import { editionListItemTextOf } from "../src/edition-list-item.js"

describe("Edition 列表项适配", () => {
  it.each([
    { item: "原有字符串", expected: "原有字符串" },
    { item: { text: "正文" }, expected: "正文" },
    { item: { id: "row-1", text: "正文" }, expected: "正文" },
  ])("合法列表项 $item 转换为文本", ({ item, expected }) => {
    const text = editionListItemTextOf(item)

    expect(text).toBe(expected)
  })

  it.each([1, null, { text: 1 }, { label: "无文本" }])("非法项 %j 原样交给合同校验", (item) => {
    const text = editionListItemTextOf(item)

    expect(text).toBe(item)
  })
})
