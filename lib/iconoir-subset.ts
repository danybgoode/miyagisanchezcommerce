import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { CATEGORIES } from './types.ts'

/**
 * hyper-performant-website S2 · Story 2.1 — build-time Iconoir subset.
 *
 * `app/layout.tsx` used to `<link>` the WHOLE Iconoir icon set from
 * `cdn.jsdelivr.net/gh/iconoir-icons/iconoir@main/...` — 204 KiB, render-
 * blocking, and unpinned (`@main` tracks the default branch — it already
 * shipped a bundle missing classes we relied on once; see the
 * emoji-to-iconoir-sweep epic's RETROSPECTIVE.md, "an unknown CSS icon class
 * is a silent failure mode"). We ship ~134 of the bundle's 1671 icon classes.
 *
 * The fix: `iconoir` is now a PINNED npm devDependency (see package.json —
 * exact version, no `^`, no CDN). `scripts/build-iconoir-subset.ts` reads the
 * real, versioned `node_modules/iconoir/css/iconoir.css`, keeps only the
 * `.iconoir-<name>::before{...}` rules this codebase actually references, and
 * writes `app/iconoir-subset.css` — imported as a normal same-origin CSS
 * module in `app/layout.tsx` (bundled with the rest of the app's critical
 * CSS, no third-party round trip, no render-blocking external request).
 *
 * This module is the SHARED logic between the generator script and the CI
 * guard spec (`e2e/iconoir-subset.spec.ts`) — same shape as
 * `lib/design-token-audit.ts` / `lib/emoji-guard.ts`: one source of truth for
 * "what does this codebase actually use," reused by both "regenerate" and
 * "verify nothing outran the last regeneration."
 */

export type IconoirClassUsage = {
  filePath: string
  lineNumber: number
  className: string
  line: string
}

export type SourceFile = {
  filePath: string
  content: string
}

// Where an `iconoir-*` class name can legally appear. The emoji-to-iconoir
// sweep's retro is explicit about this trap: a "does X reference a real Y"
// check is only as complete as its own file-type/location scope, and that
// scope silently missed real bugs THREE separate times (`.tsx`-only →
// `.ts` seller/admin-nav registries → `.json` bilingual copy dictionaries)
// before it was widened enough to find them. Scoping this fresh check to
// every location that sweep eventually had to add, from the start:
//   - app/, components/ — JSX render surfaces (.tsx) and their co-located
//     non-component helpers (.ts)
//   - lib/ — icon-bearing config/registry objects (STATUS_META-style tables,
//     nav link lists) that live outside a component file, same shape as the
//     seller/admin-nav bug the sweep's second round found
//   - locales/ — the bilingual copy dictionary (`{es,en}.json`), same shape
//     as the sweep's third-round bug
//   - app/globals.css — scanned too (see `nonGlyphSelectorTokens` below for
//     why its one match is excluded rather than the file being skipped
//     outright: skipping the whole file would silently re-open exactly the
//     gap the retro warns about if a real `.iconoir-x` ever DID land there)
export const scanDirs = ['app', 'components', 'lib', 'locales']
const sourceExtensions = new Set(['.tsx', '.ts', '.json', '.css'])

// `app/globals.css` defines the generic `[class^='iconoir-'] { display:
// inline-block }` / `.iconoir-icon` wrapper rule — a structural marker class,
// not a real glyph. It's the one legitimate non-glyph match in the scanned
// tree (confirmed: `grep -rn 'iconoir-icon\b' app lib components locales`
// finds it nowhere else as an actual className). `iconoir-subset` is this
// generated file's own name — matched wherever `iconoir-subset.css` is
// imported/referenced (the regex stops at the extension dot). Documented
// exclusion, same shape as design-token-audit.ts's `allowedLiteralRules`,
// rather than silently narrowing the scan.
// `iconoir-` bare (no suffix) is the generic `[class^="iconoir-"]` /
// `[class*=" iconoir-"]` attribute-selector prefix in app/globals.css — a
// structural match, not a glyph, and (unlike the dynamic-composition sites
// above) never followed by `${`, so it needs its own explicit exclusion.
export const nonGlyphClassNames = new Set(['iconoir-icon', 'iconoir-subset', 'iconoir-'])

// This module's OWN registry keys (e.g. the literal string 'iconoir-nav-arrow-'
// above) are themselves valid matches for the usage regex — scanning this
// file for "usage" would flag its own bookkeeping. Same self-exclusion shape
// as design-token-audit.ts excluding itself from the raw-hex-literal guard.
const scanExcludedFiles = new Set(['lib/iconoir-subset.ts'])

// `*` (not `+`) on purpose: a bare `iconoir-` with nothing after it is never
// a real class on its own, but it IS exactly what a `` `iconoir-${x}` ``
// template-literal composition looks like up to the interpolation boundary
// (e.g. `iconoir-${cat.icon}` — zero literal chars between the prefix and
// `${`). `+` would silently miss that composition site entirely (never
// produce ANY match to resolve against `dynamicCompositionSites`).
const iconoirClassPattern = /iconoir-[a-z0-9-]*/g

// Strip comments before scanning — a plain regex over raw source text will
// happily match an identifier mentioned in PROSE (this exact file's own doc
// comment says "iconoir-subset.css"; lib/emoji-guard.ts's says
// "emoji-to-iconoir-sweep"). The perf-budget spec's own header calls out the
// identical trap for a different guard ("two assertions matched a nearby
// PROSE COMMENT... not just the live code") — stripping comments up front
// closes it structurally instead of hand-listing every future false
// positive as an exception.
function stripComments(content: string) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // A `//` NOT immediately preceded by `:` (so `https://...` inside a
    // string survives) starts a line comment.
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

// Some render sites compose the class at RUNTIME as `iconoir-${dataField}`
// rather than writing the full literal — a static scan can see the literal
// prefix ("iconoir-", "iconoir-nav-arrow-") but not the interpolated
// suffix's actual values. Each entry documents exactly what the composition
// resolves to, sourced from the real data it reads (not guessed) — same
// documented-exception shape as design-token-audit.ts's `allowedLiteralRules`.
// `CATEGORIES` is imported live (not hand-copied) so a new category added to
// lib/types.ts is picked up automatically instead of silently under-covered.
export const dynamicCompositionSites: Record<string, string[]> = {
  // app/components/CategoryChips.tsx, app/(shell)/sell/SellWizard.tsx, and
  // the home category grid (app/(site)/page.tsx via lib/home-curation.ts's
  // CategoryCount, itself sourced from CATEGORIES) all render
  // `iconoir-${cat.icon}` where `cat` is (or is derived from) CATEGORIES.
  'iconoir-': CATEGORIES.map((cat) => `iconoir-${cat.icon}`).concat([
    // app/(site)/page.tsx hero trust badges — a small inline array literal,
    // not a shared data table (verified against the literal source, 2026-07-17).
    'iconoir-shield-check',
    'iconoir-chat-bubble',
    'iconoir-percentage',
  ]),
  // app/(shell)/messages/[id]/ConversationClient.tsx:
  // `iconoir-nav-arrow-${open ? 'down' : 'up'}` — exactly two branches.
  'iconoir-nav-arrow-': ['iconoir-nav-arrow-down', 'iconoir-nav-arrow-up'],
}

export async function collectIconoirSourceFiles(repoRoot: string): Promise<SourceFile[]> {
  const files = (await Promise.all(scanDirs.map((dir) => walk(repoRoot, dir)))).flat()
  return Promise.all(files.map(async (filePath) => ({
    filePath,
    content: await readFile(path.join(repoRoot, filePath), 'utf8'),
  })))
}

async function walk(repoRoot: string, dir: string): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, dir)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(repoRoot, entryPath)
    if (!sourceExtensions.has(path.extname(entry.name))) return []
    return [entryPath]
  }))
  return files.flat()
}

/** Every `iconoir-*` literal (plus resolved dynamic compositions) found in the given files, deduped by class name (first occurrence wins for reporting). */
export function findIconoirClassUsageInSourceFiles(files: SourceFile[]): IconoirClassUsage[] {
  const seen = new Map<string, IconoirClassUsage>()
  const record = (className: string, filePath: string, lineNumber: number, line: string) => {
    if (!seen.has(className)) seen.set(className, { filePath, lineNumber, className, line })
  }

  for (const file of files) {
    if (scanExcludedFiles.has(file.filePath)) continue
    stripComments(file.content).split('\n').forEach((line, index) => {
      for (const match of line.matchAll(iconoirClassPattern)) {
        const token = match[0]

        // A literal prefix immediately followed by `${` is a runtime
        // template-literal composition, not a complete class name — resolve
        // it against the documented registry FIRST, before the non-glyph
        // exclusion below (which would otherwise also match a bare
        // "iconoir-" composition prefix and silently swallow it).
        const followedByInterpolation = line.slice(match.index! + token.length, match.index! + token.length + 2) === '${'
        if (followedByInterpolation) {
          const resolved = dynamicCompositionSites[token]
          if (resolved) {
            for (const className of resolved) record(className, file.filePath, index + 1, line)
            continue
          }
          // Undocumented dynamic composition: fall through and record the
          // bare prefix as-is. It won't resolve against the real bundle
          // (by construction — a prefix alone is never a real class), so
          // buildIconoirSubsetCss's missing-class check will fail loudly and
          // point at this exact file/line, prompting a new registry entry.
        }

        if (nonGlyphClassNames.has(token)) continue
        record(token, file.filePath, index + 1, line)
      }
    })
  }
  return Array.from(seen.values()).sort((a, b) => a.className.localeCompare(b.className))
}

export async function findIconoirClassUsage(repoRoot: string): Promise<IconoirClassUsage[]> {
  return findIconoirClassUsageInSourceFiles(await collectIconoirSourceFiles(repoRoot))
}

// Each real Iconoir bundle rule is `.iconoir-<name>::before{mask-image:url('...');
// -webkit-mask-image:url('...');}` — one line, no internal `}` (the mask-image
// payload is an inline SVG data URI; SVG markup has no literal `}` character),
// so a non-greedy match up to the first `}` reliably captures exactly one
// rule. Verified against the real pinned `node_modules/iconoir/css/iconoir.css`
// (1671 rules in, 1671 unique rules out, zero truncation).
const bundleRulePattern = /\.iconoir-[a-z0-9-]+::before\{[^}]*\}/g

/** class name (without the leading dot) -> full `::before{...}` rule text, from the real pinned bundle CSS. */
export function parseIconoirBundleRules(bundleCss: string): Map<string, string> {
  const rules = new Map<string, string>()
  for (const match of bundleCss.matchAll(bundleRulePattern)) {
    const rule = match[0]
    const name = rule.slice(1, rule.indexOf('::before'))
    rules.set(name, rule)
  }
  return rules
}

export const GENERATED_HEADER = `/*
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: npm run build:iconoir
 * Source: scripts/build-iconoir-subset.ts + the pinned "iconoir" npm package
 * (see package.json — exact version, never the jsDelivr @main CDN).
 * hyper-performant-website epic, Sprint 2 · Story 2.1.
 */`

/**
 * Build the minimal same-origin stylesheet covering exactly the icon classes
 * this codebase uses. Two structural rules (sizing + display, copied from the
 * upstream bundle's own generic `[class^='iconoir-']` rule) are re-scoped to
 * an explicit, comma-joined selector list of only the used classes — NOT a
 * wildcard attribute selector — so a typo'd/unknown class silently renders
 * nothing (same as upstream) rather than accidentally matching something.
 */
export function buildIconoirSubsetCss(usedClassNames: string[], bundleRules: Map<string, string>) {
  const found: string[] = []
  const missing: string[] = []
  const glyphRules: string[] = []

  for (const name of [...usedClassNames].sort()) {
    const rule = bundleRules.get(name)
    if (!rule) {
      missing.push(name)
      continue
    }
    found.push(name)
    glyphRules.push(rule)
  }

  if (found.length === 0) {
    return { css: `${GENERATED_HEADER}\n`, found, missing }
  }

  const beforeSelectors = found.map((name) => `.${name}::before`).join(',\n')
  const displaySelectors = found.map((name) => `.${name}`).join(',\n')

  const css = [
    GENERATED_HEADER,
    '',
    `${beforeSelectors} {`,
    '  content: \' \';',
    '  display: block;',
    '  background: currentColor;',
    '  mask-size: cover;',
    '  -webkit-mask-size: cover;',
    '  width: 1em;',
    '  height: 1em;',
    '}',
    `${displaySelectors} {`,
    '  display: inline-block;',
    '}',
    ...glyphRules,
    '',
  ].join('\n')

  return { css, found, missing }
}

export function formatUsage(usage: IconoirClassUsage) {
  return `${usage.filePath}:${usage.lineNumber}: ${usage.className} in ${usage.line.trim()}`
}
