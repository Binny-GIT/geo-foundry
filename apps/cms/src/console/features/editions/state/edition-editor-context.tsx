"use client"

import { useRouter } from "next/navigation"

import { blocksToMarkdown, markdownToBlocks } from "@/editor/block-markdown"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

type Row = Record<string, unknown>

export type EditionSession = {
  readonly role: string
  readonly userId: number | null
}

type ToastKind = "success" | "error"

type ToastItem = { readonly id: number; readonly kind: ToastKind; readonly message: string }

type EditionBody = Readonly<{
  dirty: boolean
  /** 正文的 Markdown 全文（唯一编辑真相）。 */
  markdown: string
  loading: boolean
  replaceMarkdown: (next: string) => void
  /** 编辑器正文里的当前选区；无选区为 null。给「改写选中」类操作定位用。 */
  reportSelection: (next: Readonly<{ end: number; start: number; text: string }> | null) => void
  /** 派生区块视图，仅供预览/渲染消费，不是编辑入口。 */
  rows: readonly Row[]
  save: () => Promise<boolean>
  selection: Readonly<{ end: number; start: number; text: string }> | null
}>

/** 编辑器全局状态；shim 与新代码都从这里取数。 */
type EditionEditorState = Readonly<{
  dirty: boolean
  id: number | null
  readOnly: boolean
  role: string
  save: () => Promise<boolean>
  saving: boolean
  setField: (path: string, value: unknown) => void
  syncWorkflowState: () => Promise<boolean>
  updatedAt: string | null
  userId: number | null
  values: Readonly<Record<string, unknown>>
  versionCount: number
}>

const EDITABLE_KEYS: readonly string[] = [
  "angle",
  "citations",
  "dueAt",
  "editorialStatus",
  "entities",
  "owner",
  "priority",
  "primaryTopic",
  "secondaryTopics",
  "site",
  "sites",
  "summary",
  "tenant",
  "title",
]

const RELATION_KEYS: readonly string[] = ["owner", "site", "tenant"]

const idOf = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10)
  if (typeof value === "object" && value !== null) return idOf((value as Row)["id"])
  return null
}

const idsOf = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(idOf).filter((id): id is number => id !== null) : []

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : []

const arrayRowsOf = (value: unknown): readonly Row[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Row => typeof entry === "object" && entry !== null)
    : []

const initialValuesOf = (
  doc: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    angle: "",
    citations: [],
    dueAt: null,
    editorialStatus: null,
    entities: [],
    owner: null,
    priority: "normal",
    primaryTopic: "",
    secondaryTopics: [],
    site: null,
    sites: [],
    summary: "",
    tenant: null,
    title: "",
    workflowRevision: 0,
    workflowStatus: "draft",
  }
  if (doc === null) return base
  for (const key of [
    "angle",
    "dueAt",
    "editorialStatus",
    "priority",
    "primaryTopic",
    "summary",
    "title",
    "updatedAt",
    "workflowStatus",
  ]) {
    if (doc[key] !== undefined && doc[key] !== null) base[key] = doc[key]
  }
  for (const key of RELATION_KEYS) base[key] = idOf(doc[key])
  base["sites"] = idsOf(doc["sites"])
  // secondaryTopics 是 text hasMany（字符串数组），按 id 归一会把它们清空。
  base["secondaryTopics"] = stringsOf(doc["secondaryTopics"])
  for (const key of ["citations", "entities"]) base[key] = arrayRowsOf(doc[key])
  base["workflowRevision"] =
    typeof doc["workflowRevision"] === "number" ? doc["workflowRevision"] : 0
  return base
}

/**
 * 编辑器状态层：原生的文章编辑状态机（Payload 表单时代已结束）。
 *
 * 标量字段 values 与正文 Markdown 在这里统一持有；保存时一次性 PATCH。
 * doc 由服务端页面以 draft 文档传入。
 *
 * 导出面：useEditionEditor（全局状态）、useEditionBody（正文+选区）、
 * useEditionField（单字段的受控读写）、toast（编辑器通知）。历史上这里
 * 还有 @payloadcms/ui 兼容 shim（useAuth/useDocumentInfo/useFormFields/
 * useTranslation），前端去 Payload 后已删除。
 */
const EditionEditorContext = createContext<EditionEditorState | null>(null)

const EditionBodyContext = createContext<EditionBody | null>(null)

const EMPTY_BODY: EditionBody = {
  dirty: false,
  loading: false,
  markdown: "",
  replaceMarkdown: () => undefined,
  reportSelection: () => undefined,
  rows: [],
  save: async () => true,
  selection: null,
}

export const EditionEditorProvider = ({
  children,
  doc,
  readOnly,
  session,
  versionCount,
}: {
  readonly children: ReactNode
  /** 服务端加载的 draft 文档；新建时为 null。关系字段可能是对象或 id，读取时统一归一。 */
  readonly doc: Readonly<Record<string, unknown>> | null
  readonly readOnly: boolean
  readonly session: EditionSession
  readonly versionCount: number
}) => {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValuesOf(doc))
  /* Markdown 是正文唯一编辑真相：存量文章无 bodyMarkdown 时由 blocks 转换而来；
   * rows 只是给预览/AI 用的派生视图，不直接编辑。 */
  const [markdown, setMarkdown] = useState<string>(() => {
    const stored = doc?.["bodyMarkdown"]
    if (typeof stored === "string" && stored.length > 0) return stored
    return blocksToMarkdown(arrayRowsOf(doc?.["body"]))
  })
  const [valuesDirty, setValuesDirty] = useState(false)
  const [bodyDirty, setBodyDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(() =>
    typeof doc?.["updatedAt"] === "string" ? (doc["updatedAt"] as string) : null,
  )
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const toastSeq = useRef(0)
  const valuesRef = useRef(values)
  const markdownRef = useRef(markdown)
  // 服务端已确认的基线快照：用于区分“本就是空”与“用户显式清空”，
  // 并在保存成功后判断请求期间是否有新编辑。
  const initialRef = useRef(values)
  // 本地编辑序号：任何字段/正文修改递增；保存时记录提交时刻的序号，
  // 响应只确认“当时的那份内容”，请求期间的新输入保持未保存状态。
  const editsRef = useRef(0)
  // 双击锁：saving state 的更新是异步的，同步 ref 才能挡住连击的第二次进入。
  const savingRef = useRef(false)
  valuesRef.current = values
  markdownRef.current = markdown

  const notify = useCallback((kind: ToastKind, message: string) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts((current) => [...current, { id, kind, message }])
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 4200)
  }, [])

  // toast shim 是模块级单例，无法走 context；用 ref 桥接到当前 provider。
  useEffect(() => {
    notifyBridge = notify
    return () => {
      notifyBridge = null
    }
  }, [notify])

  const setField = useCallback((path: string, value: unknown) => {
    editsRef.current += 1
    setValues((current) => ({ ...current, [path]: value }))
    setValuesDirty(true)
  }, [])

  const replaceMarkdown = useCallback((next: string) => {
    editsRef.current += 1
    setMarkdown(next)
    setBodyDirty(true)
  }, [])

  type Selection = { end: number; start: number; text: string }
  const [selection, setSelection] = useState<Selection | null>(null)
  // 选区只是视图状态，不是编辑动作，不递增编辑序号。
  const reportSelection = useCallback((next: Selection | null) => {
    setSelection(next)
  }, [])

  const docId = doc === null ? null : idOf(doc["id"])

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly || savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    try {
      /* 提交时刻的不可变快照：请求期间的新编辑不进本次 payload，
       * 响应也只把这份快照登记为新的已保存基线。 */
      const submittedValues: Record<string, unknown> = { ...valuesRef.current }
      const submittedMarkdown = markdownRef.current
      const seqAtSubmit = editsRef.current
      const payload: Record<string, unknown> = {}
      for (const key of EDITABLE_KEYS) {
        const value = submittedValues[key]
        if (value === undefined) continue
        /* null 只在用户显式清空时发送（原值非空）；本就为空的字段直接省略，
         * 避免覆盖 editorialStatus/priority 等字段的服务端默认值（DB NOT NULL）。 */
        if (value === null) {
          if (initialRef.current[key] !== null && initialRef.current[key] !== undefined) {
            payload[key] = null
          }
          continue
        }
        payload[key] = value
      }
      payload["bodyMarkdown"] = submittedMarkdown
      const creating = docId === null
      if (!creating && typeof initialRef.current["updatedAt"] === "string") {
        payload["expectedUpdatedAt"] = initialRef.current["updatedAt"]
      }
      const response = await fetch(
        creating
          ? "/api/content-editions?depth=0&draft=true"
          : `/api/content-editions/${String(docId)}?depth=0&draft=true`,
        {
          body: JSON.stringify(payload),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: creating ? "POST" : "PATCH",
        },
      )
      const json = (await response.json().catch(() => ({}))) as {
        doc?: Record<string, unknown>
        errors?: readonly { message?: string }[]
        message?: string
      }
      if (!response.ok) {
        notify(
          "error",
          json.errors?.[0]?.message ?? json.message ?? "保存失败，请检查填写内容后重试。",
        )
        return false
      }
      const saved = (json.doc ?? json) as Record<string, unknown>
      const savedUpdatedAt = typeof saved["updatedAt"] === "string" ? saved["updatedAt"] : null
      const savedRevision =
        typeof saved["workflowRevision"] === "number" ? saved["workflowRevision"] : null
      const savedStatus =
        typeof saved["workflowStatus"] === "string" ? saved["workflowStatus"] : null
      setUpdatedAt(savedUpdatedAt)
      setValues((current) => ({
        ...current,
        ...(savedRevision === null ? {} : { workflowRevision: savedRevision }),
        ...(savedStatus === null ? {} : { workflowStatus: savedStatus }),
        ...(savedUpdatedAt === null ? {} : { updatedAt: savedUpdatedAt }),
      }))
      // 基线推进到已提交快照（补上服务端回写的状态字段）；仅当请求期间
      // 没有新编辑时才清除 dirty，否则这些输入继续保持“未保存”。
      initialRef.current = {
        ...submittedValues,
        ...(savedRevision === null ? {} : { workflowRevision: savedRevision }),
        ...(savedStatus === null ? {} : { workflowStatus: savedStatus }),
        ...(savedUpdatedAt === null ? {} : { updatedAt: savedUpdatedAt }),
      }
      if (editsRef.current === seqAtSubmit) {
        setValuesDirty(false)
        setBodyDirty(false)
      }
      if (creating) {
        const createdId = idOf(saved["id"])
        if (createdId === null) {
          notify("error", "创建文章失败。")
          return false
        }
        notify("success", "草稿已保存。")
        router.push(`/admin/workspace/editions/${String(createdId)}`)
        return true
      }
      notify("success", "草稿已保存。")
      return true
    } catch {
      notify("error", "保存请求未能完成，请重试。")
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [docId, notify, readOnly, router])

  /** 工作流流转/恢复后，从服务端 draft 文档回读状态字段，不触碰未保存的编辑内容。 */
  const syncWorkflowState = useCallback(async (): Promise<boolean> => {
    if (docId === null) return false
    try {
      const response = await fetch(`/api/content-editions/${String(docId)}?depth=0&draft=true`, {
        credentials: "same-origin",
      })
      if (!response.ok) return false
      const saved = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (saved === null) return false
      setValues((current) => ({
        ...current,
        updatedAt: saved["updatedAt"],
        workflowRevision: saved["workflowRevision"],
        workflowStatus: saved["workflowStatus"],
      }))
      setUpdatedAt(typeof saved["updatedAt"] === "string" ? (saved["updatedAt"] as string) : null)
      return true
    } catch {
      return false
    }
  }, [docId])

  const derivedRows = useMemo<readonly Row[]>(() => markdownToBlocks(markdown), [markdown])

  const bodyValue = useMemo<EditionBody>(
    () => ({
      dirty: bodyDirty,
      loading: false,
      markdown,
      replaceMarkdown,
      reportSelection,
      rows: derivedRows,
      save,
      selection,
    }),
    [bodyDirty, derivedRows, markdown, replaceMarkdown, reportSelection, save, selection],
  )
  const stateValue = useMemo<EditionEditorState>(
    () => ({
      dirty: valuesDirty || bodyDirty,
      id: docId,
      readOnly,
      role: session.role,
      save,
      saving,
      setField,
      syncWorkflowState,
      updatedAt,
      userId: session.userId,
      values,
      versionCount,
    }),
    [
      bodyDirty,
      docId,
      readOnly,
      save,
      saving,
      session.role,
      session.userId,
      setField,
      syncWorkflowState,
      updatedAt,
      values,
      valuesDirty,
      versionCount,
    ],
  )

  return (
    <EditionEditorContext.Provider value={stateValue}>
      <EditionBodyContext.Provider value={bodyValue}>
        {children}
        <div
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 right-6 z-[70] grid gap-2"
        >
          {toasts.map((item) => (
            <div
              className={
                item.kind === "success"
                  ? "pointer-events-auto rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-700 shadow-lg"
                  : "pointer-events-auto rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700 shadow-lg"
              }
              key={item.id}
              role="status"
            >
              {item.message}
            </div>
          ))}
        </div>
      </EditionBodyContext.Provider>
    </EditionEditorContext.Provider>
  )
}

let notifyBridge: ((kind: ToastKind, message: string) => void) | null = null

/* ------------------------------------------------------------------ *
 * 编辑器对外接口：通知、单字段读写、正文与全局状态。
 * ------------------------------------------------------------------ */

/** 编辑器内的轻量通知；Provider 未挂载时静默丢弃（如测试环境）。 */
export const toast = {
  error: (message: string) => notifyBridge?.("error", message),
  success: (message: string) => notifyBridge?.("success", message),
}

/** 单字段的受控读写：表单小组件只关心自己的 path 时用它。 */
export const useEditionField = <T,>({
  path,
}: {
  readonly path: string
}): {
  readonly setValue: (value: T) => void
  readonly value: T | undefined
} => {
  const context = useContext(EditionEditorContext)
  const value = context?.values[path] as T | undefined
  const setValue = useCallback(
    (next: T) => {
      context?.setField(path, next)
    },
    [context, path],
  )
  return { setValue, value }
}

export const useEditionBody = (): EditionBody => {
  const context = useContext(EditionBodyContext)
  return context ?? EMPTY_BODY
}

/** 新代码专用：读取编辑器全局状态（仅在 Provider 内有效）。 */
export const useEditionEditor = (): EditionEditorState | null => useContext(EditionEditorContext)
