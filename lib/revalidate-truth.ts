import fs from 'node:fs'
import path from 'node:path'

export type RouteTruthInput = { entry: string; expectedRevalidate?: number }
export type RouteTruthFinding = { route: string; file: string; reason: string }

const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs'] as const

function resolveSource(specifier: string, importer: string, root: string): string | null {
  let stem: string
  if (specifier.startsWith('@/')) stem = path.join(root, specifier.slice(2))
  else if (specifier.startsWith('.')) stem = path.resolve(path.dirname(importer), specifier)
  else return null

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${stem}${extension}`
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  for (const extension of SOURCE_EXTENSIONS.slice(1)) {
    const candidate = path.join(stem, `index${extension}`)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function sourceImports(source: string): string[] {
  const imports = new Set<string>()
  const patterns = [
    /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const matcher of patterns) {
    let match: RegExpExecArray | null
    while ((match = matcher.exec(source))) imports.add(match[1])
  }
  return [...imports]
}

function routeLayouts(entry: string, root: string): string[] {
  const appRoot = path.join(root, 'app')
  const layouts: string[] = []
  let directory = path.dirname(entry)
  while (directory.startsWith(appRoot)) {
    const layout = path.join(directory, 'layout.tsx')
    if (fs.existsSync(layout)) layouts.push(layout)
    if (directory === appRoot) break
    directory = path.dirname(directory)
  }
  return layouts
}

export function resolveImportLayoutGraph(entry: string, root: string): string[] {
  const absoluteEntry = path.resolve(root, entry)
  if (!fs.existsSync(absoluteEntry)) throw new Error(`route entry missing: ${entry}`)
  const queue = [absoluteEntry, ...routeLayouts(absoluteEntry, root)]
  const visited = new Set<string>()

  while (queue.length) {
    const file = queue.shift()!
    if (visited.has(file)) continue
    visited.add(file)
    const source = fs.readFileSync(file, 'utf8')
    if (/^['"]use client['"];?/m.test(source)) continue
    for (const specifier of sourceImports(source)) {
      const resolved = resolveSource(specifier, file, root)
      if (resolved && resolved.startsWith(root)) queue.push(resolved)
    }
  }
  return [...visited].sort()
}

function literalRevalidate(source: string): number | null {
  const match = /export\s+const\s+revalidate\s*=\s*(\d+)\b/.exec(source)
  return match ? Number(match[1]) : null
}

/** Story 2.3: resolve the page/layout/import chain rather than grepping one file. */
export function revalidateTruthFindings(routes: RouteTruthInput[], root: string): RouteTruthFinding[] {
  const findings: RouteTruthFinding[] = []
  for (const route of routes) {
    const entry = path.resolve(root, route.entry)
    const literal = literalRevalidate(fs.readFileSync(entry, 'utf8'))
    if (route.expectedRevalidate !== undefined && literal !== route.expectedRevalidate) {
      findings.push({
        route: route.entry,
        file: route.entry,
        reason: `revalidate must be literal ${route.expectedRevalidate}; found ${literal ?? 'none/non-literal'}`,
      })
    }
    // Correct negation: a deliberately dynamic route with no revalidate passes.
    if (literal === null) continue

    for (const file of resolveImportLayoutGraph(route.entry, root)) {
      const source = fs.readFileSync(file, 'utf8')
      const relative = path.relative(root, file)
      if (/from\s+['"]next\/headers['"]/.test(source)) {
        findings.push({ route: route.entry, file: relative, reason: 'imports next/headers' })
      }
      if (/from\s+['"]@clerk\/nextjs\/server['"]/.test(source)) {
        findings.push({ route: route.entry, file: relative, reason: 'imports Clerk server request state' })
      }
      if (/['"][^'"]*shop-presentation\/preview['"]/.test(source)) {
        findings.push({ route: route.entry, file: relative, reason: 'imports owner preview overlay' })
      }
    }
  }
  return findings
}
