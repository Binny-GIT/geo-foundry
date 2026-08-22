import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const forbiddenPatterns = [
  {
    code: "CI_SECRET_PEM_DETECTED",
    pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/u,
  },
  {
    code: "CI_SECRET_AWS_ACCESS_KEY_DETECTED",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  },
  {
    code: "CI_SECRET_GITHUB_TOKEN_DETECTED",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u,
  },
]

export const assertSafeText = (path, text) => {
  for (const rule of forbiddenPatterns) {
    if (rule.pattern.test(text)) {
      throw new Error(`${rule.code}:${path}`)
    }
  }
}

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)

const isText = (body) => !body.includes(0)

export const scanTrackedFiles = () => {
  for (const path of trackedFiles()) {
    const body = readFileSync(path)
    if (body.byteLength > 1_000_000 || !isText(body)) {
      continue
    }
    assertSafeText(path, body.toString("utf8"))
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  scanTrackedFiles()
}
