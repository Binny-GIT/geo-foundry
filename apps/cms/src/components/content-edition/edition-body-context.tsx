"use client"

import { useDocumentInfo } from "@payloadcms/ui"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

type Row = Record<string, unknown>

type EditionBody = Readonly<{
  dirty: boolean
  loading: boolean
  replace: (rows: readonly Row[]) => void
  rows: readonly Row[]
  save: () => Promise<boolean>
}>

const EMPTY: EditionBody = {
  dirty: false,
  loading: false,
  replace: () => undefined,
  rows: [],
  save: async () => true,
}

const EditionBodyContext = createContext<EditionBody>(EMPTY)

const rowsOf = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Row => typeof entry === "object" && entry !== null)
    : []

/**
 * The body lives outside Payload's form state on purpose.
 *
 * Payload never puts a `blocks` field into the flat form state this custom
 * view can read, so `useField({ path: "body" })` always reported an empty
 * array and every block edit was silently dropped. The article body is
 * therefore loaded from the draft document and written back with its own
 * PATCH; the surrounding Payload form keeps owning the scalar fields, and
 * because `body` is absent from that form state its submission never
 * overwrites what we saved here.
 */
export const EditionBodyProvider = ({ children }: { readonly children: ReactNode }) => {
  const { data, id } = useDocumentInfo()
  const [rows, setRows] = useState<readonly Row[]>(() => rowsOf(data?.["body"]))
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (id === undefined || id === null) return
    const key = String(id)
    if (loadedFor.current === key) return
    const fromDocument = rowsOf(data?.["body"])
    if (fromDocument.length > 0) {
      loadedFor.current = key
      setRows(fromDocument)
      setDirty(false)
      return
    }
    setLoading(true)
    void fetch(`/api/content-editions/${key}?depth=0&draft=true`, { credentials: "same-origin" })
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((document_: unknown) => {
        loadedFor.current = key
        setRows(rowsOf((document_ as Record<string, unknown> | null)?.["body"]))
        setDirty(false)
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [data, id])

  const replace = useCallback((next: readonly Row[]) => {
    setRows(JSON.parse(JSON.stringify(next)) as Row[])
    setDirty(true)
  }, [])

  const save = useCallback(async () => {
    if (id === undefined || id === null || !dirty) return true
    const response = await fetch(`/api/content-editions/${id}?depth=0&draft=true`, {
      body: JSON.stringify({ body: rows }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    })
    if (!response.ok) return false
    setDirty(false)
    return true
  }, [dirty, id, rows])

  return (
    <EditionBodyContext.Provider value={{ dirty, loading, replace, rows, save }}>
      {children}
    </EditionBodyContext.Provider>
  )
}

export const useEditionBody = (): EditionBody => useContext(EditionBodyContext)
