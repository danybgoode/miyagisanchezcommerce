import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  buildIconoirSubsetCss,
  findIconoirClassUsage,
  findIconoirClassUsageInSourceFiles,
  formatUsage,
  parseIconoirBundleRules,
} from '../lib/iconoir-subset.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

test.describe('iconoir subset · CI guard (hyper-performant-website S2 · Story 2.1)', () => {
  test('app/layout.tsx no longer <link>s the jsDelivr CDN (the 204 KiB render-blocking request)', () => {
    const layout = read('app/layout.tsx')
    // Scoped to an actual <link ... href="...jsdelivr..."> tag, not a bare
    // substring — the file keeps a doc-comment explaining what this replaced
    // (which itself mentions the old domain), and a bare substring check
    // would falsely red on that prose exactly the way the S1 perf-budget
    // spec's own header warns against.
    expect(layout).not.toMatch(/<link[^>]*jsdelivr\.net[^>]*>/)
  })

  test('app/layout.tsx imports the generated same-origin subset stylesheet', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/import\s+'\.\/iconoir-subset\.css'/)
  })

  // THE hard gate: red the moment a new `iconoir-*` class is used anywhere in
  // the live tree without app/iconoir-subset.css being regenerated to cover
  // it. Recomputes usage independently from the real source tree (not just
  // trusting `npm run build:iconoir` was run) — same "verify, don't trust"
  // shape as the S1 perf-budget spec's live round-trip check.
  test('every iconoir-* class actually used in app/components/lib/locales resolves inside the generated subset', async () => {
    const subsetCss = read('app/iconoir-subset.css')
    const usage = await findIconoirClassUsage(repoRoot)
    expect(usage.length).toBeGreaterThan(0)

    const uncovered = usage.filter((entry) => !subsetCss.includes(`.${entry.className}::before{`))
    expect(uncovered.map(formatUsage)).toEqual([])
  })

  test('the generated subset file carries its GENERATED header (guards against a silent hand-edit going stale)', () => {
    const subsetCss = read('app/iconoir-subset.css')
    expect(subsetCss).toMatch(/GENERATED FILE — do not edit by hand/)
    expect(subsetCss).toMatch(/npm run build:iconoir/)
  })

  test('the pinned iconoir package version matches what generated the checked-in subset (package.json exact pin, no caret)', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.devDependencies.iconoir).toBe('7.11.1')
  })
})

test.describe('iconoir subset · mechanism fixtures (negative cases — prove the guard actually catches drift)', () => {
  test('negative fixture: a brand-new icon class with no matching bundle rule is reported as missing', () => {
    const { missing } = buildIconoirSubsetCss(
      ['iconoir-heart', 'iconoir-totally-made-up-glyph-xyz'],
      parseIconoirBundleRules(".iconoir-heart::before{mask-image:url('data:image/svg+xml,<svg></svg>');}"),
    )
    expect(missing).toEqual(['iconoir-totally-made-up-glyph-xyz'])
  })

  test('negative fixture: an unused real class is NOT pulled into the subset (stays minimal)', () => {
    const bundle = parseIconoirBundleRules(
      ".iconoir-heart::before{mask-image:url('data:image/svg+xml,<svg>heart</svg>');}" +
      ".iconoir-star::before{mask-image:url('data:image/svg+xml,<svg>star</svg>');}",
    )
    const { css, found } = buildIconoirSubsetCss(['iconoir-heart'], bundle)
    expect(found).toEqual(['iconoir-heart'])
    expect(css).toContain('iconoir-heart')
    expect(css).not.toContain('iconoir-star')
  })

  test('negative fixture: a prose comment mentioning an iconoir-* identifier is NOT counted as usage', () => {
    const usage = findIconoirClassUsageInSourceFiles([
      { filePath: 'app/components/Fake.tsx', content: '// this component replaced iconoir-old-glyph, see the emoji-to-iconoir-sweep epic' },
      { filePath: 'app/components/Fake2.tsx', content: '/* iconoir-block-comment-glyph is unused now */' },
    ])
    expect(usage).toEqual([])
  })

  test('negative fixture: a real (quoted) className usage IS counted', () => {
    const usage = findIconoirClassUsageInSourceFiles([
      { filePath: 'app/components/Fake.tsx', content: '<i className="iconoir-heart" aria-hidden />' },
    ])
    expect(usage.map((u) => u.className)).toEqual(['iconoir-heart'])
  })

  test('negative fixture: an undocumented dynamic `iconoir-${x}`-style composition is NOT silently swallowed — the bare prefix surfaces so it can be reported', () => {
    const usage = findIconoirClassUsageInSourceFiles([
      { filePath: 'app/components/Fake.tsx', content: '<i className={`iconoir-totally-new-prefix-${x}`} />' },
    ])
    // Not in the documented dynamicCompositionSites registry, so the bare
    // (always-invalid) prefix is recorded as-is — buildIconoirSubsetCss will
    // then report it as "missing", which is the actionable failure mode.
    expect(usage.map((u) => u.className)).toEqual(['iconoir-totally-new-prefix-'])
  })

  // codex (PR #279 review round) flagged stripComments() (lib/iconoir-subset.ts)
  // as a potential string-truncation risk: its line-comment stripper treats any
  // `//` not immediately preceded by `:` as a comment start, which is safe for
  // the `https://...` case it was built for but isn't a full tokenizer — a
  // non-URL string containing a bare `//` would still get chopped. These two
  // fixtures prove the patterns THIS codebase actually has survive correctly;
  // the third documents the accepted narrow gap rather than silently leaving
  // it unproven either way.
  test('regression fixture: a real className usage survives on the same line as an https:// URL (the actual pattern in this codebase)', () => {
    const usage = findIconoirClassUsageInSourceFiles([
      {
        filePath: 'app/components/Fake.tsx',
        content: '<a href="https://example.com/docs" className="iconoir-arrow-up-right" aria-hidden>Ver más</a>',
      },
    ])
    expect(usage.map((u) => u.className)).toEqual(['iconoir-arrow-up-right'])
  })

  test('regression fixture: a real className usage survives inside a JSX block comment ({/* ... */}) on an adjacent, non-commented line', () => {
    const usage = findIconoirClassUsageInSourceFiles([
      {
        filePath: 'app/components/Fake.tsx',
        content: '{/* legacy iconoir-old-glyph removed */}\n<i className="iconoir-heart" aria-hidden />',
      },
    ])
    expect(usage.map((u) => u.className)).toEqual(['iconoir-heart'])
  })

  test('KNOWN GAP, documented not fixed: a real className usage on the SAME line as a non-URL string containing a bare "//" can be mis-truncated', () => {
    // stripComments() only special-cases the `://` shape (protocol-relative
    // URLs); a bare "//" elsewhere in a string — e.g. a doubled path
    // separator with no protocol prefix — still reads as a line-comment
    // start. Not observed anywhere in the current app/+components/+lib/+
    // locales/ tree (verified by grep before writing this fixture), and a
    // false NEGATIVE here (missing a real usage) fails LOUD via the
    // coverage-gate test above whenever it would actually matter — build-
    // iconoir-subset.ts's missing-class check has no visibility into
    // classes it never saw, so this is a real edge, just not one this
    // codebase currently hits. A full tokenizer is the permanent fix; out
    // of scope for this sprint's "cheap fix" bar.
    const usage = findIconoirClassUsageInSourceFiles([
      { filePath: 'app/components/Fake.tsx', content: 'const path = "/api//legacy"; const cls = "iconoir-heart"' },
    ])
    expect(usage.map((u) => u.className)).toEqual([]) // documents the gap — NOT the desired behavior
  })

  test('documented fixture: the CATEGORIES-derived dynamic composition resolves to real, non-empty class names', () => {
    const usage = findIconoirClassUsageInSourceFiles([
      { filePath: 'app/components/CategoryChips.tsx', content: '<i className={`iconoir-${cat.icon}`} aria-hidden />' },
    ])
    expect(usage.length).toBeGreaterThan(5)
    for (const entry of usage) {
      expect(entry.className.startsWith('iconoir-')).toBe(true)
      expect(entry.className).not.toBe('iconoir-')
    }
  })
})
