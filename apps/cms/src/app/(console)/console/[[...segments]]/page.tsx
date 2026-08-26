import { redirect } from "next/navigation"

type LegacyConsoleRouteProps = {
  readonly params: Promise<{ readonly segments?: readonly string[] }>
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>
}

const LegacyConsoleRoute = async ({ params, searchParams }: LegacyConsoleRouteProps) => {
  const [{ segments = [] }, query] = await Promise.all([params, searchParams])
  const suffix = segments.map(encodeURIComponent).join("/")
  const destination = suffix.length === 0 ? "/admin" : `/admin/${suffix}`
  const values = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") values.set(key, value)
    else if (Array.isArray(value)) {
      for (const item of value) values.append(key, item)
    }
  }
  const serialized = values.toString()
  redirect(serialized.length === 0 ? destination : `${destination}?${serialized}`)
}

export default LegacyConsoleRoute
