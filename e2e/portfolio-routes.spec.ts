import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Merchant Partner lifecycle · Sprint 1 — route guards for the surfaces this
 * sprint adds, in two layers.
 *
 * LAYER 1 (live, against `baseURL`): the invariant that holds in EVERY
 * environment and in every flag state — an anonymous caller never gets a 200 and
 * never gets portfolio data. Deliberately NOT the "404 text/html → 404 JSON
 * content-type flip" assertion the sibling activation-ops specs use: that shape
 * is red-by-construction until the PR is deployed, so it cannot be part of a
 * gate that must be green before the PR is opened. It is also, right now, a
 * BROKEN signal in this family — see the note in
 * `e2e/relationship-stewardship.spec.ts` (those specs assert 404 and prod now
 * returns 401, because `promoter.activation_crm_enabled` was flipped ON after
 * they were written). This spec asserts the property that cannot rot: no 200, no
 * data, no 5xx.
 *
 * LAYER 2 (source text, network-free): what layer 1 cannot see anonymously —
 * that the flag gate really is FIRST in every new route, that the read-only
 * routes export no write method, that `/partner`'s shipped grant list is
 * untouched and the new section is strictly conditional, and that nothing in
 * this epic can reach a merchant-facing transport. The transport population is
 * RE-DERIVED from the filesystem (`lib/**` modules that actually send), not from
 * a hand-written list, so a transport added later is covered without editing
 * this spec (LEARNINGS: "guard the population, not the door you found"). This is
 * an early down-payment on README D5, whose full form lands in Sprint 2.
 *
 * RED-OBSERVED (red-green DoD): see the PR body.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Every new route file this sprint adds. Story 1.3's reassign route gets its
 *  detailed treatment in `e2e/portfolio-reassign.spec.ts`; it is listed here too
 *  so the sprint-wide guards below (gate-first, no transport import) cover it —
 *  the population is the sprint's routes, not one story's. */
const NEW_ROUTE_FILES = [
  'app/api/partner/portfolio/route.ts',
  'app/api/admin/sla-policy/route.ts',
  'app/api/admin/relationship/[id]/reassign/route.ts',
]

/**
 * `lib/portfolio/gate-server.ts` is `server-only`, so it cannot be IMPORTED
 * here — the `server-only` package throws unconditionally outside a webpack
 * `react-server` build (the same constraint `lib/scorecard/dictionary.ts`'s
 * header documents). The flag string is therefore asserted against the gate's
 * SOURCE, which is the stronger check anyway: it proves the constant is defined
 * there once, rather than merely that some module exports that value.
 */
const PORTFOLIO_FLAG = 'promoter.partner_portfolio_enabled'

// ── Layer 1 · live guards ────────────────────────────────────────────────────

test.describe('live · GET /api/partner/portfolio never serves an anonymous caller', () => {
  test('never 200, never a portfolio body, never a 5xx', async ({ request }) => {
    const res = await request.get('/api/partner/portfolio')
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
    expect(await res.text()).not.toContain('"rows"')
  })

  test('a garbage filter query changes nothing about that', async ({ request }) => {
    const res = await request.get('/api/partner/portfolio?view=all&due=../../etc&stage=toString&blocker=maybe')
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('live · /api/admin/sla-policy never serves an anonymous caller', () => {
  test('GET → never 200, never a policy body, never a 5xx', async ({ request }) => {
    const res = await request.get('/api/admin/sla-policy')
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
    expect(await res.text()).not.toContain('"stages"')
  })

  test('PUT → never 200 (an anonymous caller can never write the policy), never a 5xx', async ({ request }) => {
    const res = await request.put('/api/admin/sla-policy', { data: { policy: { version: 99, stages: {} } } })
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
  })

  test('PUT with a malformed body still never 500s (the gate short-circuits before parsing)', async ({ request }) => {
    const res = await request.put('/api/admin/sla-policy', { data: 'not-an-object' })
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('live · /partner never renders anonymously', () => {
  test('anonymous GET → never a bare 200 page, whatever the flag state', async ({ request }) => {
    // Flag OFF or the partners gate OFF ⇒ 404; both ON ⇒ a 3xx to /sign-in.
    // Never a rendered portfolio.
    const res = await request.get('/partner', { maxRedirects: 0 }).catch(() => null)
    if (res) {
      expect(res.status()).not.toBe(200)
      expect(await res.text()).not.toContain('Cartera de comercios')
    }
  })
})

// ── Layer 2 · the flag gate is FIRST in every new route ──────────────────────

test.describe('source · every new route runs the portfolio flag gate before anything else', () => {
  test('the gate reads the epic flag, and the flag string lives in exactly one place', () => {
    const gate = read('lib/portfolio/gate-server.ts')
    expect(gate).toContain(`export const PORTFOLIO_FLAG = '${PORTFOLIO_FLAG}' as const`)
    // 404 when OFF, indistinguishable from an absent route.
    expect(gate).toMatch(/isEnabled\(PORTFOLIO_FLAG\)/)
    expect(gate).toMatch(/status:\s*404/)
    // Clerk before the rate limit before the actor resolution. Measured inside
    // the FUNCTION BODY only — the import block mentions the same identifiers in
    // a different order, and matching those would make this assertion about
    // import style rather than about execution order.
    const body = gate.slice(gate.indexOf('export async function authorizePortfolioRequest'))
    const clerkAt = body.indexOf('currentUser()')
    const rateAt = body.indexOf('checkRateLimit(')
    const actorAt = body.indexOf('resolveActor(')
    const flagAt = body.indexOf('isEnabled(PORTFOLIO_FLAG)')
    expect(body.length).toBeGreaterThan(0)
    expect(flagAt).toBeGreaterThan(-1)
    expect(flagAt).toBeLessThan(clerkAt)
    expect(clerkAt).toBeLessThan(rateAt)
    expect(rateAt).toBeLessThan(actorAt)
  })

  test('the actor rule is IMPORTED from the shipped seam, never reimplemented (README D2)', () => {
    const gate = read('lib/portfolio/gate-server.ts')
    expect(gate).toMatch(/import\s*\{[^}]*resolveActor[^}]*\}\s*from\s*'@\/lib\/relationship-access'/)
    // No second promoter/admin lookup of its own.
    expect(gate).not.toContain('getPromoterByClerkId')
    expect(gate).not.toContain('currentUserIsAdmin')
  })

  /** Split a route file into its exported HTTP handlers. Checking the file as a
   *  whole would be too weak: a first-occurrence comparison passes as soon as
   *  ANY handler gates early, even if a later one reads the body first. Verified
   *  non-vacuous by planting an early `await req.json()` in the PUT handler —
   *  the whole-file version passed, this version reds. */
  function handlerBodies(text: string): Array<{ method: string; body: string }> {
    const re = /export async function (GET|POST|PUT|PATCH|DELETE)\(/g
    const starts: Array<{ method: string; at: number }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) starts.push({ method: m[1], at: m.index })
    return starts.map((s, i) => ({
      method: s.method,
      body: text.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : text.length),
    }))
  }

  for (const file of NEW_ROUTE_FILES) {
    test(`every exported handler in ${file} awaits the gate FIRST`, () => {
      const handlers = handlerBodies(read(file))
      expect(handlers.length, 'no exported handler found — the scan would be vacuous').toBeGreaterThan(0)
      for (const { method, body } of handlers) {
        const gateAt = body.indexOf('await authorizePortfolioRequest(req)')
        expect(gateAt, `${method} must call the gate`).toBeGreaterThan(-1)
        // The gate must be the FIRST await in the handler — nothing may read the
        // body, the params or the database ahead of it.
        const firstAwaitAt = body.indexOf('await ')
        expect(firstAwaitAt, `${method}: the gate must be the first await`).toBe(gateAt)
      }
    })
  }

  test('the portfolio read route exports GET and nothing else — no write method exists on it', () => {
    const text = read('app/api/partner/portfolio/route.ts')
    expect(text).toMatch(/export async function GET\(/)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(text, method).not.toMatch(new RegExp(`export async function ${method}\\(`))
    }
  })

  test('the portfolio read route turns a failed read into a 500, never a silently-empty 200', () => {
    const text = read('app/api/partner/portfolio/route.ts')
    expect(text).toMatch(/if\s*\(!result\.ok\)/)
    expect(text).toMatch(/status:\s*500/)
  })

  test('the admin routes narrow to isAdmin explicitly after the shared gate', () => {
    for (const file of ['app/api/admin/sla-policy/route.ts', 'app/api/admin/relationship/[id]/reassign/route.ts']) {
      const text = read(file)
      expect(text, file).toContain('auth.actor.isAdmin')
      expect(text, file).toMatch(/status:\s*403/)
    }
  })
})

// ── Layer 2 · /partner's kill-switch promise ─────────────────────────────────

test.describe('source · /partner is byte-identical with the flag OFF', () => {
  const page = read('app/(shell)/partner/page.tsx')

  test('the portfolio section is rendered ONLY inside a flag-conditional expression', () => {
    // `{portfolioEnabled && <PartnerPortfolio …/>}` — React renders nothing for
    // `false`, so the served markup is unchanged while the flag is OFF.
    const body = page.slice(page.indexOf('export default async function'))
    expect(body).toMatch(/\{portfolioEnabled\s*&&\s*<PartnerPortfolio/)
    // And the component appears EXACTLY ONCE in the rendered tree, so it cannot
    // also be rendered somewhere unconditionally. Counted in the function body
    // only — the file header names it in prose.
    expect(body.match(/<PartnerPortfolio/g) ?? []).toHaveLength(1)
  })

  test('the flag is read through the shared constant, not a re-typed string literal', () => {
    expect(page).toContain('isEnabled(PORTFOLIO_FLAG)')
    expect(page).not.toContain("'promoter.partner_portfolio_enabled'")
  })

  test("today's grant-list markup is untouched — every shipped string still present", () => {
    for (const shipped of [
      'Mis tiendas',
      'Todavía no tienes tiendas asignadas',
      'No encontramos una cuenta de socio vinculada a tu sesión.',
      'Vincula tu código de promotor (PRM-…) en',
      'Ver tienda',
      'Administrar',
      "isEnabled('partners.mcp_enabled')",
    ]) {
      expect(page, shipped).toContain(shipped)
    }
  })

  test('the container class is a complete literal in both flag states — never string-interpolated', () => {
    expect(page).toContain("'max-w-2xl mx-auto px-4 py-8 space-y-6'")
    expect(page).toContain("'max-w-4xl mx-auto px-4 py-8 space-y-6'")
    // A Tailwind arbitrary value built by interpolation silently emits no CSS
    // (LEARNINGS) — there must be no `${` inside any className on this page.
    expect(page).not.toMatch(/className=\{`[^`]*\$\{/)
  })

  test('searchParams is awaited (Next.js 16: it is a Promise)', () => {
    expect(page).toMatch(/await searchParams/)
  })
})

// ── Layer 2 · no path from this epic to a merchant-facing transport (D5) ─────

test.describe('population guard · nothing in this epic can reach a merchant-facing transport', () => {
  /** RE-DERIVED from the filesystem: every `lib/**` module that actually sends
   *  something outward. A module added later is caught without editing this
   *  spec. */
  function discoverTransportModules(): string[] {
    const out: string[] = []
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
        // A sender either talks to a messaging/email API or writes the web-push
        // notification table. Both shapes are detected, not enumerated.
        const sends =
          /api\.telegram\.org/.test(text) ||
          /api\.resend\.com/.test(text) ||
          /\bsendEmail\s*\(/.test(text) ||
          /getSellerEmail/.test(text) ||
          /\bwa\.me\b/.test(text)
        if (sends) out.push(relative(ROOT, full).replace(/\\/g, '/'))
      }
    }
    walk(join(ROOT, 'lib'))
    return out
  }

  const TRANSPORTS = discoverTransportModules()

  test('sanity — the discovered transport population is non-empty and includes the known senders', () => {
    expect(TRANSPORTS.length).toBeGreaterThan(0)
    for (const known of ['lib/telegram.ts', 'lib/email.ts', 'lib/notifications/dispatch.ts']) {
      expect(TRANSPORTS, known).toContain(known)
    }
  })

  test('no module under lib/portfolio/ imports any discovered transport', () => {
    const offenders: string[] = []
    for (const entry of readdirSync(join(ROOT, 'lib', 'portfolio'))) {
      if (extname(entry) !== '.ts') continue
      const text = read(`lib/portfolio/${entry}`)
      for (const transport of TRANSPORTS) {
        const spec = transport.replace(/^lib\//, '@/lib/').replace(/\.ts$/, '')
        if (text.includes(`from '${spec}'`)) offenders.push(`lib/portfolio/${entry} → ${transport}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('no new route imports any discovered transport', () => {
    const offenders: string[] = []
    for (const file of NEW_ROUTE_FILES) {
      const text = read(file)
      for (const transport of TRANSPORTS) {
        const spec = transport.replace(/^lib\//, '@/lib/').replace(/\.ts$/, '')
        if (text.includes(`from '${spec}'`)) offenders.push(`${file} → ${transport}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
