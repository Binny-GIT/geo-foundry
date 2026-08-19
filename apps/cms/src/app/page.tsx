import { redirect } from "next/navigation"

/** The CMS has no public root page; send visitors to the admin entry. */
const RootPage = () => redirect("/admin")

export default RootPage
