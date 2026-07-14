import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditDocumentedContrastPairs,
  findArbitraryHexClassOffenders,
  findArbitraryHexClassOffendersInSourceFiles,
  findBgWhiteOffenders,
  findBgWhiteOffendersInSourceFiles,
  findFeedbackImportOffenders,
  findFeedbackImportOffendersInSourceFiles,
  findInvisibleAccentButtonOffenders,
  findInvisibleAccentButtonOffendersInSourceFiles,
  findLiteralRadiusOffenders,
  findLiteralRadiusOffendersInSourceFiles,
  findRawHexLiteralOffenders,
  findRawHexLiteralOffendersInSourceFiles,
  findRawPaletteClassOffenders,
  findRawPaletteClassOffendersInSourceFiles,
  formatContrastResult,
  formatOffense,
  withinEnforcedSweep,
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

  // ── seller-portal-rails-foundation S2 · Story 2.2 ──────────────────────────
  // The adoption sweep's actual coverage — `enforcedSweptPaths` — must have zero
  // raw-palette/bg-white/literal-radius violations. The rest of app/+lib/ is scanned
  // too (for visibility as future sprints expand the sweep) but not yet gated: Story
  // 2.1 swept a named subset of the seller portal, not the whole app, so gating the
  // whole tree today would fail on ~50 untouched files this sprint never scoped.
  test('the S2 adoption sweep has no raw palette classes in its enforced coverage', async () => {
    const offenders = withinEnforcedSweep(await findRawPaletteClassOffenders(repoRoot))
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('the S2 adoption sweep has no bg-white in its enforced coverage', async () => {
    const offenders = withinEnforcedSweep(await findBgWhiteOffenders(repoRoot))
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('the S2 adoption sweep has no literal border-radius classes in its enforced coverage', async () => {
    const offenders = withinEnforcedSweep(await findLiteralRadiusOffenders(repoRoot))
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('no Toast/Banner import lives outside components/feedback/, anywhere in app/+lib/', async () => {
    const offenders = await findFeedbackImportOffenders(repoRoot)
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('negative fixture: a new raw palette class goes red inside enforced coverage, stays advisory outside it', () => {
    const files = [
      { filePath: 'app/(shell)/shop/manage/ManageDashboard.tsx', content: '<span className="bg-green-100 text-green-700">Activo</span>' },
      { filePath: 'app/(shell)/shop/manage/analytics/AnalyticsClient.tsx', content: '<span className="bg-green-100 text-green-700">Activo</span>' },
    ]
    const offenders = findRawPaletteClassOffendersInSourceFiles(files)
    expect(offenders.map(formatOffense)).toEqual([
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: bg-green-100 in <span className="bg-green-100 text-green-700">Activo</span>',
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: text-green-700 in <span className="bg-green-100 text-green-700">Activo</span>',
      'app/(shell)/shop/manage/analytics/AnalyticsClient.tsx:1: bg-green-100 in <span className="bg-green-100 text-green-700">Activo</span>',
      'app/(shell)/shop/manage/analytics/AnalyticsClient.tsx:1: text-green-700 in <span className="bg-green-100 text-green-700">Activo</span>',
    ])
    // Only the enforced file's offense is gating; the unswept sibling is advisory-only.
    expect(withinEnforcedSweep(offenders).map(formatOffense)).toEqual([
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: bg-green-100 in <span className="bg-green-100 text-green-700">Activo</span>',
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: text-green-700 in <span className="bg-green-100 text-green-700">Activo</span>',
    ])
  })

  test('negative fixture: bg-white goes red, bg-white/NN translucent overlays stay green', () => {
    const offenders = findBgWhiteOffendersInSourceFiles([{
      filePath: 'app/(shell)/shop/manage/ManageDashboard.tsx',
      content: '<div className="bg-white"><span className="bg-white/30">x</span></div>',
    }])
    expect(offenders.map(formatOffense)).toEqual([
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: bg-white in <div className="bg-white"><span className="bg-white/30">x</span></div>',
    ])
  })

  test('negative fixture: literal radii go red, the token-var arbitrary form stays green', () => {
    const offenders = findLiteralRadiusOffendersInSourceFiles([{
      filePath: 'app/(shell)/shop/manage/ManageDashboard.tsx',
      content: '<div className="rounded"><span className="rounded-lg" /><i className="rounded-[var(--r-md)]" /></div>',
    }])
    expect(offenders.map(formatOffense)).toEqual([
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: rounded in <div className="rounded"><span className="rounded-lg" /><i className="rounded-[var(--r-md)]" /></div>',
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: rounded-lg in <div className="rounded"><span className="rounded-lg" /><i className="rounded-[var(--r-md)]" /></div>',
    ])
  })

  // seller-portal-rails-foundation S2.5 cleanup — the original pattern above only
  // matched bare `rounded` or `rounded-<size>`, silently missing Tailwind's
  // directional/corner classes (`rounded-l`, `rounded-tl`, …) entirely. `Envios.tsx`
  // used `rounded-l`/`rounded-r` on grouped input+suffix controls with zero coverage.
  test('negative fixture: directional/corner radii go red, their fixed token-var arbitrary form stays green', () => {
    const offenders = findLiteralRadiusOffendersInSourceFiles([{
      filePath: 'app/(shell)/shop/manage/ManageDashboard.tsx',
      content: '<input className="rounded-l" /><span className="rounded-r-lg" /><i className="rounded-l-[var(--r-sm)]" />',
    }])
    expect(offenders.map(formatOffense)).toEqual([
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: rounded-l in <input className="rounded-l" /><span className="rounded-r-lg" /><i className="rounded-l-[var(--r-sm)]" />',
      'app/(shell)/shop/manage/ManageDashboard.tsx:1: rounded-r-lg in <input className="rounded-l" /><span className="rounded-r-lg" /><i className="rounded-l-[var(--r-sm)]" />',
    ])
  })

  test('negative fixture: a Toast import outside components/feedback/ goes red', () => {
    const offenders = findFeedbackImportOffendersInSourceFiles([
      { filePath: 'app/(shell)/shop/manage/ManageDashboard.tsx', content: "import { Toast } from '@/components/feedback/Toast'" },
      { filePath: 'app/(shell)/shop/manage/RogueToast.tsx', content: "import { Toast } from './LocalToast'" },
    ])
    expect(offenders.map(formatOffense)).toEqual([
      "app/(shell)/shop/manage/RogueToast.tsx:1: import { Toast } from './LocalToast' in import { Toast } from './LocalToast'",
    ])
  })

  // ── cms-contenido-restore-and-polish S3.4 ──────────────────────────────────
  // The whole `app/(shell)/admin/` prefix is normally EXCLUDED from every scan
  // above (not merely unenforced) — Sprint 3's re-skin touched 4 admin files,
  // so `enforcedDespiteExcludedPrefix` un-excludes exactly those 4 (paired with
  // adding them to `enforcedSweptPaths`), while every other admin file stays
  // fully excluded until it's touched.
  test('a re-skinned admin/contenido file (Sprint 3) IS scanned and gated, despite the app/(shell)/admin/ prefix exclusion', () => {
    const offenders = findRawPaletteClassOffendersInSourceFiles([{
      filePath: 'app/(shell)/admin/AdminShell.tsx',
      content: '<span className="bg-green-100 text-green-700">Activo</span>',
    }])
    expect(offenders.map(formatOffense)).toEqual([
      'app/(shell)/admin/AdminShell.tsx:1: bg-green-100 in <span className="bg-green-100 text-green-700">Activo</span>',
      'app/(shell)/admin/AdminShell.tsx:1: text-green-700 in <span className="bg-green-100 text-green-700">Activo</span>',
    ])
    expect(withinEnforcedSweep(offenders).map(formatOffense)).toEqual(offenders.map(formatOffense))
  })

  test('an UNTOUCHED admin file stays fully excluded (not scanned at all) — the broad prefix exclusion still applies elsewhere', () => {
    const offenders = findRawPaletteClassOffendersInSourceFiles([{
      filePath: 'app/(shell)/admin/coupons/AdminCouponsClient.tsx',
      content: '<span className="bg-green-100 text-green-700">Activo</span>',
    }])
    expect(offenders).toEqual([])
  })
})
