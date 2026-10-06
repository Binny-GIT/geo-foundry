/** Edition 文本列表项转为 v1 字符串；非法项原样保留，交给严格合同报错。 */
export const editionListItemTextOf = (item: unknown): unknown =>
  item !== null && typeof item === "object" && "text" in item && typeof item.text === "string"
    ? item.text
    : item
