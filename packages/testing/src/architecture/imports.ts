import { access, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

export async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

export async function listTypeScriptFiles(directory: string): Promise<readonly string[]> {
  if (!(await pathExists(directory))) {
    return []
  }
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        return listTypeScriptFiles(path)
      }
      return /\.(?:[cm]?ts|tsx)$/.test(entry.name) ? [path] : []
    }),
  )
  return nested.flat().sort()
}

export async function importedSpecifiers(path: string): Promise<readonly string[]> {
  const source = await readFile(path, "utf8")
  const specifiers: string[] = []
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2]
    if (specifier !== undefined) {
      specifiers.push(specifier)
    }
  }
  return specifiers
}

export function packageNameFromSpecifier(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

export function publicSubpath(specifier: string): string {
  const packageName = packageNameFromSpecifier(specifier)
  const suffix = specifier.slice(packageName.length)
  return suffix.length === 0 ? "." : `.${suffix}`
}
