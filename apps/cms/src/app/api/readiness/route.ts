import { checkRuntimeReadiness } from "../../../readiness/runtime-readiness"
import { assertNever } from "../../../shared/assert-never"

export const dynamic = "force-dynamic"

const readinessHttpStatus = (status: "not_ready" | "ready"): 200 | 503 => {
  switch (status) {
    case "not_ready":
      return 503
    case "ready":
      return 200
    default:
      return assertNever(status)
  }
}

export const GET = async (): Promise<Response> => {
  const report = await checkRuntimeReadiness(process.env)
  return Response.json(report, { status: readinessHttpStatus(report.status) })
}
