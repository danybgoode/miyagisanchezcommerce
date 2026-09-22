import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * flag-provider-mandate S2.2/S2.3 — a SOURCE sweep, because the second lane was deleted by hand and
 * a claim of "nothing reads it any more" is unguarded until the source is swept for the negation
 * (LEARNINGS: "every call site reads the constant" was asserted while four did not).
 *
 * Asserts, over every runtime file (app/, lib/, components/, middleware.ts):
 *  - nothing READS `platform_flags` — the table is parked, not the rollback of record;
 *  - nothing reads the retired env vars that could move a decision off Golden;
 *  - no module imports the deleted cutover machinery.
 * Comments are stripped before matching: explaining WHY the table is parked is allowed and wanted.
 */

const ROOT = join(import.meta.dirname, '..')
const RUNTIME_DIRS = ['app', 'lib', 'components']
const RUNTIME_FILES = ['middleware.ts']

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(path)
  }
}

function runtimeFiles(): string[] {
  const files: string[] = []
  for (const dir of RUNTIME_DIRS) walk(join(ROOT, dir), files)
  for (const file of RUNTIME_FILES) files.push(join(ROOT, file))
  return files
}

/** Strip block and line comments; keep strings, which is where a table name would be. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const files = runtimeFiles()

test.describe('flags · one lane, swept from source', () => {
  test('the sweep actually visits the runtime (a guard over an empty set passes forever)', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files.some((file) => file.endsWith(join('lib', 'flags.ts')))).toBe(true)
  })

  test('no runtime code reads platform_flags', () => {
    const offenders = files.filter((file) => /['"`]platform_flags['"`]/.test(code(readFileSync(file, 'utf8'))))
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([])
  })

  test('no runtime code reads an env var that could move a decision off Golden', () => {
    const retired = /GOLDEN_BEANS_FLAG_CUTOVER|GOLDEN_BEANS_FLAG_PROVIDER_MODE|GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY/
    const offenders = files.filter((file) => retired.test(code(readFileSync(file, 'utf8'))))
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([])
  })

  test('nothing imports the deleted cutover machinery', () => {
    const deleted = /['"](?:@\/lib\/|\.\/|\.\.\/lib\/)(?:flag-cutover|flag-provider-mode|flag-shadow-observation|flag-authority-observation|golden-flag-read-key-routing|golden-flag-mirror-scope|flags-cache|flags-admin)['"]/
    const offenders = files.filter((file) => deleted.test(readFileSync(file, 'utf8')))
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([])
  })

  test('the admin flags route exports no write handler', () => {
    const route = code(readFileSync(join(ROOT, 'app/api/admin/flags/route.ts'), 'utf8'))
    expect(route).toMatch(/export const GET\b/)
    expect(route).not.toMatch(/export (?:const|async function|function) (?:POST|PUT|PATCH|DELETE)\b/)
  })
})
