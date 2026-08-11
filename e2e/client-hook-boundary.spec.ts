import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * A server component that calls a client hook builds, type-checks and lints clean,
 * then throws at REQUEST time:
 *
 *   Error: Attempted to call useBuyerPresentation() from the server but
 *   useBuyerPresentation is on the client.
 *
 * That is exactly how `ListingTypeChips` 500'd every `/l` browse page — MX and US
 * — in production while all four CI shards were green. Nothing in the deterministic
 * gate renders a page, so nothing caught it.
 *
 * This guard enumerates the POPULATION mechanically: every `'use client'` module's
 * exported `use*` hooks, and every importer of one. Hand-listing the known callers
 * would decay the moment someone adds the next component.
 */

const ROOT = path.join(import.meta.dirname, '..')
const SOURCE_DIRS = ['app', 'lib']
const HOOK_EXPORT = /export\s+function\s+(use[A-Z]\w*)/g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** `'use client'` must be the module's first statement to take effect. */
function isClientModule(source: string): boolean {
  return /^\s*(['"])use client\1/.test(source)
}

function sourceFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))
}

/** Resolve an import specifier to a real file, honouring the `@/` root alias. */
function resolveSpecifier(specifier: string, importer: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(importer), specifier)
  else return null

  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

interface Violation { importer: string; hook: string; from: string }

function findViolations(files: string[], read: (f: string) => string): Violation[] {
  // Which client modules export which hooks.
  const clientHooks = new Map<string, Set<string>>()
  for (const file of files) {
    const source = read(file)
    if (!isClientModule(source)) continue
    const hooks = new Set<string>()
    for (const [, name] of source.matchAll(HOOK_EXPORT)) hooks.add(name)
    if (hooks.size > 0) clientHooks.set(file, hooks)
  }

  const violations: Violation[] = []
  for (const file of files) {
    const source = read(file)
    if (isClientModule(source)) continue // a client module may call client hooks freely
    for (const [, names, specifier] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const target = resolveSpecifier(specifier, file)
      if (!target) continue
      const hooks = clientHooks.get(target)
      if (!hooks) continue
      for (const raw of names.split(',')) {
        // `import { useX as y }` still imports the hook; the local alias is irrelevant.
        const imported = raw.trim().split(/\s+as\s+/)[0].trim()
        if (hooks.has(imported)) {
          violations.push({ importer: path.relative(ROOT, file), hook: imported, from: path.relative(ROOT, target) })
        }
      }
    }
  }
  return violations
}

test.describe('client-hook boundary · server components may not call client hooks', () => {
  test('no server module imports a client hook', () => {
    const violations = findViolations(sourceFiles(), (f) => fs.readFileSync(f, 'utf8'))
    expect(violations.map((v) => `${v.importer} calls ${v.hook}() from ${v.from}`)).toEqual([])
  })

  test('the guard actually sees the real client hooks (it is not vacuously green)', () => {
    const files = sourceFiles()
    const context = files.find((f) => f.endsWith(path.join('app', 'components', 'BuyerPresentationContext.tsx')))
    expect(context, 'BuyerPresentationContext must still exist').toBeTruthy()
    const source = fs.readFileSync(context!, 'utf8')
    expect(isClientModule(source)).toBe(true)
    expect([...source.matchAll(HOOK_EXPORT)].map(([, n]) => n)).toContain('useBuyerPresentation')
  })

  // The regression itself, as a fixture: ListingTypeChips without 'use client'
  // importing useBuyerPresentation is precisely what shipped and 500'd.
  test('negative fixture: a server component importing a client hook is reported', () => {
    const chips = path.join(ROOT, 'app/components/ListingTypeChips.tsx')
    const context = path.join(ROOT, 'app/components/BuyerPresentationContext.tsx')
    const mutated = (f: string) => f === chips
      ? "import { BuyerCopyText, useBuyerPresentation } from '@/app/components/BuyerPresentationContext'\n"
      : fs.readFileSync(f, 'utf8')

    const violations = findViolations([chips, context], mutated)
    expect(violations).toHaveLength(1)
    expect(violations[0].hook).toBe('useBuyerPresentation')
  })

  test('negative fixture: the same import inside a client module is NOT reported', () => {
    const chips = path.join(ROOT, 'app/components/ListingTypeChips.tsx')
    const context = path.join(ROOT, 'app/components/BuyerPresentationContext.tsx')
    const mutated = (f: string) => f === chips
      ? "'use client'\nimport { useBuyerPresentation } from '@/app/components/BuyerPresentationContext'\n"
      : fs.readFileSync(f, 'utf8')

    expect(findViolations([chips, context], mutated)).toEqual([])
  })

  // Always allow the negation of what we ban: importing a non-hook VALUE from a
  // client module is legitimate and common (`BuyerCopyText` is a component).
  test('negative fixture: importing a non-hook export from a client module stays green', () => {
    const chips = path.join(ROOT, 'app/components/ListingTypeChips.tsx')
    const context = path.join(ROOT, 'app/components/BuyerPresentationContext.tsx')
    const mutated = (f: string) => f === chips
      ? "import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'\n"
      : fs.readFileSync(f, 'utf8')

    expect(findViolations([chips, context], mutated)).toEqual([])
  })
})
