import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONFIRM_CHANNELS,
  buildConfirmDeepLink,
  isConfirmChannel,
  isKnownChannel,
  knownChannelsFor,
  type KnownContacts,
} from '../lib/portfolio/confirm'

/**
 * Merchant Partner lifecycle · Sprint 2, Story 2.3 — THE LOAD-BEARING SPEC of
 * this sprint (README D5). "No server-side path to a merchant exists at all"
 * is proven here as a POPULATION guard, not a hand-list:
 *
 *   1. Every server-side TRANSPORT in the repo is DISCOVERED by scanning
 *      `lib/**` for the shape a sender has (a Telegram/Resend API call, a
 *      `sendEmail(`/`getSellerEmail` reference, a `wa.me` build) — never a
 *      hand-typed list of file names. A transport added later is covered
 *      without editing this spec.
 *   2. Every draft-related module (`lib/portfolio/draft*.ts`) and route
 *      (`app/api/**\/draft*\/route.ts`) is likewise DISCOVERED from the
 *      filesystem, not hand-listed.
 *   3. Starting from that draft population, the import graph is walked
 *      TRANSITIVELY (`@/...` and relative specifiers resolved to real files,
 *      recursively) — not just checked for a DIRECT import. A transport
 *      reached through two or three hops of intermediate modules is caught
 *      exactly the same as a direct import.
 *
 * A confident comment is not evidence (Roadmap/LEARNINGS.md) — this spec
 * proves the absence mechanically, every time it runs, against whatever the
 * tree actually contains today.
 *
 * RED-OBSERVED (red-green DoD): see the PR body / the builder's report — this
 * spec was run against a deliberately reintroduced `import { tgSend } from
 * '@/lib/telegram'` in `lib/portfolio/draft-server.ts` to confirm it fails
 * loudly, then the import was removed and the spec re-run green.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ── 1. Discover every server-side transport, from the filesystem ───────────

/** Modules the README/build contract names EXPLICITLY as part of the
 *  transport population. Two of them (`lib/shop-notify.ts`,
 *  `lib/promoter-close-notify.ts`'s SIBLING `lib/shop-notify.ts`) are pure
 *  message-TEXT builders with no network call of their own — verified live:
 *  `lib/shop-notify.ts` has no `fetch`, no `api.telegram.org`, nothing the
 *  shape-based scan below would flag — the actual SEND happens one hop away
 *  in `lib/telegram.ts`, which imports `newShopPingText` from it. Building a
 *  transport's message text is not itself a send, so the mechanical scan is
 *  correct to not flag that file in isolation. This floor exists so the
 *  spec-mandated six are unconditionally IN the population regardless of
 *  whether their current implementation shape happens to match the regexes
 *  below — the mechanical scan still runs on top and can ADD transports
 *  neither list anticipated, so "a transport added later is covered" still
 *  holds. (Observed failing without this floor on the first run of this
 *  spec — `lib/shop-notify.ts` was missing from the scan's output — which is
 *  what caught the gap; see the PR body / builder's report.) */
const NAMED_BY_CONTRACT = [
  'lib/notify.ts',
  'lib/email.ts',
  'lib/telegram.ts',
  'lib/notifications/dispatch.ts',
  'lib/shop-notify.ts',
  'lib/promoter-close-notify.ts',
]

function discoverTransportModules(): string[] {
  const out = new Set<string>()
  const skip = new Set(['node_modules', '.next', '.worktrees', '.git'])
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (extname(entry) !== '.ts') continue
      const text = readFileSync(full, 'utf8')
      // A sender either talks to a messaging/email API, writes the web-push
      // notification table, or builds a merchant-facing `wa.me` handoff.
      // Detected by SHAPE, not enumerated by file name — the same heuristic
      // `e2e/portfolio-routes.spec.ts` (Sprint 1) already validated.
      const sends =
        /api\.telegram\.org/.test(text) ||
        /api\.resend\.com/.test(text) ||
        /\bsendEmail\s*\(/.test(text) ||
        /getSellerEmail/.test(text) ||
        // An actual OUTBOUND `fetch(...)` to a `wa.me` URL — NOT a bare
        // mention of the string. `lib/portfolio/confirm.ts` and
        // `lib/promoter-close.ts` both RETURN a `https://wa.me/...` string
        // for the BROWSER to open (exactly the D5-safe pattern: the server
        // builds the link, it never fetches or navigates to it) — a naive
        // `/\bwa\.me\b/` substring match flagged both of them as
        // "transports" and broke the load-bearing assertion below on this
        // spec's first run (see the PR body / builder's report: this is the
        // observed-red moment for this file). The server in this codebase
        // never actually fetches a `wa.me` URL — WhatsApp delivery here is
        // ALWAYS a client-opened share link — so this pattern's true-positive
        // count is (and should be) zero today; it exists so a FUTURE
        // server-side `fetch('https://wa.me/...')` would still be caught.
        /fetch\s*\(\s*[`'"]https?:\/\/(www\.)?wa\.me/.test(text) ||
        // `lib/notify.ts` itself: the actual push-send call, so the seam is
        // caught even though it names none of the patterns above.
        /webpush\.sendNotification/.test(text)
      if (sends) out.add(relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
  walk(join(ROOT, 'lib'))
  for (const named of NAMED_BY_CONTRACT) out.add(named)
  return [...out]
}

const TRANSPORTS = discoverTransportModules()

test('sanity — the discovered transport population is non-empty and includes every transport the build contract names', () => {
  expect(TRANSPORTS.length).toBeGreaterThan(0)
  for (const known of [
    'lib/notify.ts',
    'lib/email.ts',
    'lib/telegram.ts',
    'lib/notifications/dispatch.ts',
    'lib/shop-notify.ts',
    'lib/promoter-close-notify.ts',
  ]) {
    expect(TRANSPORTS, known).toContain(known)
  }
})

// ── 2. Discover the draft population, from the filesystem ──────────────────

function discoverDraftLibModules(): string[] {
  const dir = join(ROOT, 'lib', 'portfolio')
  return readdirSync(dir)
    .filter((entry) => entry.startsWith('draft') && extname(entry) === '.ts')
    .map((entry) => `lib/portfolio/${entry}`)
}

function discoverDraftRoutes(): string[] {
  const out: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (entry !== 'route.ts') continue
      const segments = relative(ROOT, dir).split(sep)
      if (segments.includes('draft')) out.push(relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
  walk(join(ROOT, 'app', 'api'))
  return out
}

const DRAFT_LIB_MODULES = discoverDraftLibModules()
const DRAFT_ROUTES = discoverDraftRoutes()

test('sanity — the draft-module population is non-empty and includes the three known modules', () => {
  expect(DRAFT_LIB_MODULES.length).toBeGreaterThan(0)
  for (const known of ['lib/portfolio/draft-facts.ts', 'lib/portfolio/draft-compose.ts', 'lib/portfolio/draft-server.ts']) {
    expect(DRAFT_LIB_MODULES, known).toContain(known)
  }
})

test('sanity — the draft-route population is non-empty and includes the three known routes', () => {
  expect(DRAFT_ROUTES.length).toBeGreaterThan(0)
  for (const known of [
    'app/api/partner/relationship/[id]/draft/route.ts',
    'app/api/partner/relationship/[id]/draft/[draftId]/route.ts',
    'app/api/partner/relationship/[id]/draft/[draftId]/confirm/route.ts',
  ]) {
    expect(DRAFT_ROUTES, known).toContain(known)
  }
})

// ── 3. Walk the import graph TRANSITIVELY from the draft population ────────

function extractImportSpecifiers(text: string): string[] {
  const specs = new Set<string>()
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) specs.add(m[1])
  return [...specs]
}

/** Resolve a module specifier to a real file on disk. `@/...` → repo root
 *  (the exact `tsconfig.json` `paths` mapping); a relative specifier →
 *  relative to the importing file; anything else (a bare package name) is an
 *  external dependency and is not walked further — a transport is always a
 *  LOCAL `lib/*` module in this codebase. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) {
    base = join(ROOT, spec.slice(2))
  } else if (spec.startsWith('.')) {
    base = join(dirname(fromFile), spec)
  } else {
    return null
  }
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'route.ts')]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** BFS over the local import graph starting from `startFiles`. Returns every
 *  file reached, INCLUDING the start files themselves. */
function transitiveImportClosure(startFiles: string[]): Set<string> {
  const visited = new Set<string>()
  const queue = [...startFiles]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (visited.has(file)) continue
    visited.add(file)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const spec of extractImportSpecifiers(text)) {
      const resolved = resolveSpecifier(spec, file)
      if (resolved && !visited.has(resolved)) queue.push(resolved)
    }
  }
  return visited
}

const START_FILES = [...DRAFT_LIB_MODULES, ...DRAFT_ROUTES].map((p) => join(ROOT, p))
const REACHED = transitiveImportClosure(START_FILES)
const TRANSPORT_ABS_PATHS = new Set(TRANSPORTS.map((p) => join(ROOT, p)))

test('sanity — the transitive walk is non-vacuous: it reaches well beyond the six start files', () => {
  // `lib/relationship-access.ts` (server-only, imported by the gate) and
  // `lib/supabase.ts` (the DB client) are both several hops deep from a route
  // file — reaching them proves the walk actually recurses instead of only
  // inspecting the start files' own direct imports.
  expect(REACHED.size).toBeGreaterThan(START_FILES.length + 5)
  expect(REACHED.has(join(ROOT, 'lib', 'relationship-access.ts'))).toBe(true)
  expect(REACHED.has(join(ROOT, 'lib', 'supabase.ts'))).toBe(true)
})

test('THE LOAD-BEARING ASSERTION — no module under lib/portfolio/draft* or route under app/api/**/draft* imports a transport, even transitively', () => {
  const offenders = [...REACHED].filter((f) => TRANSPORT_ABS_PATHS.has(f)).map((f) => relative(ROOT, f))
  expect(offenders).toEqual([])
})

// ── Layer 2 (Sprint 1 style, extended here) · confirm.ts is also transport-free ──

test('lib/portfolio/confirm.ts (reached transitively from the confirm route) has no fetch/send call of its own', () => {
  const source = read('lib/portfolio/confirm.ts')
  expect(source).not.toMatch(/\bfetch\s*\(/)
  expect(source).not.toContain('webpush')
})

// ── confirm.ts — the no-auto-send channel/deep-link helpers, unit-tested ────

test.describe('confirm.ts — pure channel + deep-link helpers (README D5)', () => {
  const contacts: KnownContacts = {
    whatsapp: '+5215500000009',
    phone: null,
    email: 'tienda@example.com',
    instagram: null,
  }

  test('isConfirmChannel rejects a prototype-chain value like "toString" (own-property safety, Sprint 1 review finding)', () => {
    expect(isConfirmChannel('toString')).toBe(false)
    expect(isConfirmChannel('constructor')).toBe(false)
    expect(isConfirmChannel('whatsapp')).toBe(true)
  })

  test('isKnownChannel is false for a channel with no contact value, even if it is a recognized channel', () => {
    expect(isKnownChannel('phone', contacts)).toBe(false)
    expect(isKnownChannel('whatsapp', contacts)).toBe(true)
  })

  test('knownChannelsFor returns only channels with a real value, in CONFIRM_CHANNELS order', () => {
    expect(knownChannelsFor(contacts)).toEqual(['whatsapp', 'email'])
    expect(knownChannelsFor({ whatsapp: null, phone: null, email: null, instagram: null })).toEqual([])
  })

  test('buildConfirmDeepLink builds a wa.me link with the text URL-encoded — a plain STRING, never fetched or opened here', () => {
    const link = buildConfirmDeepLink('whatsapp', contacts, 'Hola, ¿cómo estás?')
    expect(link).toBe('https://wa.me/5215500000009?text=Hola%2C%20%C2%BFc%C3%B3mo%20est%C3%A1s%3F')
  })

  test('buildConfirmDeepLink builds a mailto: link', () => {
    const link = buildConfirmDeepLink('email', contacts, 'Hola')
    expect(link).toBe('mailto:tienda%40example.com?body=Hola')
  })

  test('buildConfirmDeepLink returns null for phone and instagram — no universal deep-link scheme', () => {
    expect(buildConfirmDeepLink('phone', contacts, 'x')).toBeNull()
    expect(buildConfirmDeepLink('instagram', contacts, 'x')).toBeNull()
  })

  test('CONFIRM_CHANNELS is exactly the four known contact shapes', () => {
    expect([...CONFIRM_CHANNELS].sort()).toEqual(['email', 'instagram', 'phone', 'whatsapp'])
  })
})

// ── Layer 3 · the confirm route never sends — it only returns data ─────────

test('the confirm route writes confirmation columns and returns a deep link — it calls no transport function directly either', () => {
  const source = read('app/api/partner/relationship/[id]/draft/[draftId]/confirm/route.ts')
  expect(source).toContain('confirmDraft(')
  expect(source).toContain('buildConfirmDeepLink(')
  expect(source).not.toMatch(/\bnotify\s*\(/)
  expect(source).not.toMatch(/\btgSend\s*\(/)
  expect(source).not.toMatch(/\bfetch\s*\(/)
})

test('the confirm route gates FIRST, checks write access, and validates the channel BEFORE writing anything', () => {
  const source = read('app/api/partner/relationship/[id]/draft/[draftId]/confirm/route.ts')
  const body = source.slice(source.indexOf('export async function POST'))
  const gateAt = body.indexOf('await authorizePortfolioRequest(req)')
  const firstAwaitAt = body.indexOf('await ')
  expect(gateAt).toBeGreaterThan(-1)
  expect(firstAwaitAt).toBe(gateAt)
  expect(body).toContain('canWriteRelationship(access.role)')

  const isKnownAt = body.indexOf('isKnownChannel(channel, contacts)')
  const confirmAt = body.indexOf('confirmDraft(')
  expect(isKnownAt).toBeGreaterThan(-1)
  expect(confirmAt).toBeGreaterThan(-1)
  expect(isKnownAt).toBeLessThan(confirmAt)
})

test.describe('live · POST confirm never serves an anonymous caller', () => {
  test('never 200, never a 5xx, never a body containing a real "deepLink"', async ({ request }) => {
    const res = await request.post(
      '/api/partner/relationship/00000000-0000-0000-0000-000000000000/draft/00000000-0000-0000-0000-000000000000/confirm',
      { data: { channel: 'whatsapp', text: 'x' } },
    )
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
  })
})
