export const dynamic = "force-dynamic"

export const GET = (): Response => Response.json({ status: "alive" }, { status: 200 })
