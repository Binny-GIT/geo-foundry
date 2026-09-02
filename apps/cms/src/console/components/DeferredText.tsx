"use client"

import { type ReactNode, useEffect, useState } from "react"

/*
 * Cloudflare's email obfuscation rewrites email-like text nodes in the
 * delivered HTML ("[email protected]"), which breaks React hydration
 * (minified error #418). Render such text only after mount so the server
 * HTML never carries the raw address.
 */
const DeferredText = ({ children }: { readonly children: ReactNode }) => {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  return mounted ? children : null
}

export default DeferredText
