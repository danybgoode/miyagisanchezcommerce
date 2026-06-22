import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditDocumentedContrastPairs,
  findArbitraryHexClassOffenders,
  findArbitraryHexClassOffendersInSourceFiles,
  findInvisibleAccentButtonOffenders,
  findInvisibleAccentButtonOffendersInSourceFiles,
  findRawHexLiteralOffenders,
  findRawHexLiteralOffendersInSourceFiles,
  formatContrastResult,
  formatOffense,
} from '../lib/design-token-audit'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test.describe('design-token foundation', () => {
  test('documented semantic token pairs meet WCAG AA thresholds or carry rationale', async () => {
    const globalsCss = await readFile(path.join(repoRoot, 'app/globals.css'), 'utf8')
    const results = auditDocumentedContrastPairs(globalsCss)
    const unreviewedFailures = results
      .filter((result) => !result.passes && !result.rationale)
      .map(formatContrastResult)
    const reviewedFlags = results
      .filter((result) => !result.passes && result.rationale)
      .map((result) => `${formatContrastResult(result)} — ${result.rationale}`)

    expect(unreviewedFailures).toEqual([])
    expect(reviewedFlags).toEqual([
      'FLAGGED Subtle text on page canvas: --fg-subtle #a4a49d on --bg #f9f9f7 = 2.38 (min 3) — --fg-subtle is reserved for placeholder/metadata affordances; body copy must use --fg-muted or stronger.',
    ])
  })

  test('customer-facing source does not use arbitrary hex utility classes', async () => {
    const offenders = await findArbitraryHexClassOffenders(repoRoot)
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('customer-facing source keeps raw hex behind the allowlist', async () => {
    const offenders = await findRawHexLiteralOffenders(repoRoot)
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('negative fixture: a new guarded raw hex goes red', () => {
    const offenders = findRawHexLiteralOffendersInSourceFiles([{
      filePath: 'app/components/CartButton.tsx',
      content: 'export function Demo() { return <span style={{ color: "#ff0000" }}>x</span> }',
    }])

    expect(offenders.map(formatOffense)).toEqual([
      'app/components/CartButton.tsx:1: #ff0000 in export function Demo() { return <span style={{ color: "#ff0000" }}>x</span> }',
    ])
  })

  test('negative fixture: a new arbitrary hex class goes red', () => {
    const offenders = findArbitraryHexClassOffendersInSourceFiles([{
      filePath: 'app/components/CartButton.tsx',
      content: 'export function Demo() { return <span className="bg-[#ff0000]">x</span> }',
    }])

    expect(offenders.map(formatOffense)).toEqual([
      'app/components/CartButton.tsx:1: bg-[#ff0000] in export function Demo() { return <span className="bg-[#ff0000]">x</span> }',
    ])
  })

  test('customer-facing source has no invisible accent buttons (bg-[var(--accent)] + untyped text-[var(--fg-inverse)])', async () => {
    const offenders = await findInvisibleAccentButtonOffenders(repoRoot)
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('negative fixture: an invisible accent button goes red; the .btn-primary and typed-hint fixes stay green', () => {
    const broken = findInvisibleAccentButtonOffendersInSourceFiles([{
      filePath: 'app/components/CartButton.tsx',
      content: '<a className="bg-[var(--accent)] text-[var(--fg-inverse)] px-4 py-2">Comprar</a>',
    }])
    expect(broken.map(formatOffense)).toEqual([
      'app/components/CartButton.tsx:1: bg-[var(--accent)] + text-[var(--fg-inverse)] in <a className="bg-[var(--accent)] text-[var(--fg-inverse)] px-4 py-2">Comprar</a>',
    ])

    // Both prescribed fixes clear the guard: the .btn-primary primitive (buttons)
    // and the typed text-[color:var(--fg-inverse)] hint (chips/badges).
    const fixed = findInvisibleAccentButtonOffendersInSourceFiles([
      { filePath: 'app/a.tsx', content: '<a className="btn btn-primary">Comprar</a>' },
      { filePath: 'app/b.tsx', content: '<span className="bg-[var(--accent)] text-[color:var(--fg-inverse)]">1</span>' },
    ])
    expect(fixed.map(formatOffense)).toEqual([])
  })

  test('allowlist fixture: fixed-format/generated contexts stay green', () => {
    const files = [
      { filePath: 'lib/email.ts', content: 'export const email = "<p style=\\"color:#ff0000\\">x</p>"' },
      { filePath: 'lib/print-export.ts', content: 'export const css = ".ad{background:#ff0000}"' },
      { filePath: 'lib/platform-theme.ts', content: 'export const CORE_ACCENT = "#1d6f42"' },
      { filePath: 'lib/settings-import.ts', content: "export const EXAMPLE_CONFIG = { profile: { accent_color: '#1d6f42' } }" },
      { filePath: 'app/opengraph-image.tsx', content: 'export const color = "#ff0000"' },
      { filePath: 'app/(shell)/admin/page.tsx', content: 'export const color = "#ff0000"' },
      { filePath: 'app/style-sandbox/page.tsx', content: 'export const color = "#ff0000"' },
    ]

    expect(findRawHexLiteralOffendersInSourceFiles(files).map(formatOffense)).toEqual([])
    expect(findArbitraryHexClassOffendersInSourceFiles(files).map(formatOffense)).toEqual([])
  })
})
