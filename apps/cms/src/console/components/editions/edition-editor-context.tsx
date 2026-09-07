"use client"

import { useRouter } from "next/navigation"
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
  loading: boolean
  replace: (rows: readonly Row[]) => void
  rows: readonly Row[]
  save: () => Promise<boolean>
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
  "content",
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

const RELATION_KEYS: readonly string[] = ["content", "owner", "site", "tenant"]

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
    content: null,
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
 * 编辑器状态层：替代 Payload 表单状态机的原生实现。
 *
 * Payload 的 blocks 字段永远进不了它的扁平表单状态（历史上因此丢过正文），
 * 所以正文 rows 与标量字段都在这里统一持有；保存时一次性 PATCH，彻底移除
 * 「表单先存、正文补丁」的双请求顺序。doc 由服务端页面以 draft 文档传入。
 *
 * 本文件同时导出 @payloadcms/ui 的兼容 shim（toast/useTranslation/useAuth/
 * useDocumentInfo/useField/useFormFields/useEditionBody）：迁移期间存量编辑器
 * 组件只需把 import 来源换成这里，调用点零改动。任务 2 视觉统一到 console
 * tokens 后，这些 shim 与各家组件一起逐步消失。
 */
const EditionEditorContext = createContext<EditionEditorState | null>(null)

const EditionBodyContext = createContext<EditionBody | null>(null)

const EMPTY_BODY: EditionBody = {
  dirty: false,
  loading: false,
  replace: () => undefined,
  rows: [],
  save: async () => true,
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
  const [rows, setRows] = useState<readonly Row[]>(() => arrayRowsOf(doc?.["body"]))
  const [valuesDirty, setValuesDirty] = useState(false)
  const [bodyDirty, setBodyDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(() =>
    typeof doc?.["updatedAt"] === "string" ? (doc["updatedAt"] as string) : null,
  )
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const toastSeq = useRef(0)
  const valuesRef = useRef(values)
  const rowsRef = useRef(rows)
  // 服务端已确认的基线快照：用于区分“本就是空”与“用户显式清空”，
  // 并在保存成功后判断请求期间是否有新编辑。
  const initialRef = useRef(values)
  // 本地编辑序号：任何字段/正文修改递增；保存时记录提交时刻的序号，
  // 响应只确认“当时的那份内容”，请求期间的新输入保持未保存状态。
  const editsRef = useRef(0)
  // 双击锁：saving state 的更新是异步的，同步 ref 才能挡住连击的第二次进入。
  const savingRef = useRef(false)
  valuesRef.current = values
  rowsRef.current = rows

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

  const replaceBody = useCallback((next: readonly Row[]) => {
    editsRef.current += 1
    setRows(JSON.parse(JSON.stringify(next)) as Row[])
    setBodyDirty(true)
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
      const submittedRows = rowsRef.current
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
      payload["body"] = submittedRows
      const creating = docId === null
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

  const bodyValue = useMemo<EditionBody>(
    () => ({ dirty: bodyDirty, loading: false, replace: replaceBody, rows, save }),
    [bodyDirty, replaceBody, rows, save],
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
 * @payloadcms/ui 兼容 shim：签名保持一致，存量组件只换 import 来源。
 * ------------------------------------------------------------------ */

export const toast = {
  error: (message: string) => notifyBridge?.("error", message),
  success: (message: string) => notifyBridge?.("success", message),
}

export const useTranslation = (): { readonly i18n: { readonly language: string } } => {
  // Console 是纯中文界面；固定 zh 让组件内的 uiLangOf 分支自然收敛。
  return { i18n: { language: "zh" } }
}

export const useAuth = (): {
  readonly user: { readonly id: number | null; readonly role: string } | null
} => {
  const context = useContext(EditionEditorContext)
  if (context === null) return { user: null }
  return { user: { id: context.userId, role: context.role } }
}

export const useDocumentInfo = (): {
  readonly data: Readonly<Record<string, unknown>> | null
  readonly id: number | null
  readonly versionCount: number
} => {
  const context = useContext(EditionEditorContext)
  if (context === null) return { data: null, id: null, versionCount: 0 }
  return {
    data: { updatedAt: context.updatedAt },
    id: context.id,
    versionCount: context.versionCount,
  }
}

export const useField = <T,>({
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

export const useFormFields = <T,>(
  select: (fields: readonly [Readonly<Record<string, { readonly value?: unknown }>>]) => T,
): T => {
  const context = useContext(EditionEditorContext)
  const fields: Record<string, { readonly value?: unknown }> = {}
  for (const [key, value] of Object.entries(context?.values ?? {})) {
    fields[key] = { value }
  }
  // Payload 的 selector 以 [fields] 解构为参；元组保证首元素非空（strict 下可用）。
  return select([fields])
}

export const useEditionBody = (): EditionBody => {
  const context = useContext(EditionBodyContext)
  return context ?? EMPTY_BODY
}

/** 新代码专用：读取编辑器全局状态（仅在 Provider 内有效）。 */
export const useEditionEditor = (): EditionEditorState | null => useContext(EditionEditorContext)
