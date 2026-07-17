import { expect, test } from '@playwright/test'

/**
 * Miyagi Partners · Sprint 2 (miyagi-partners-mcp) — funnel auto-grant + `/partner`
 * dashboard + seller-side revoke. Same shape as `e2e/agent-connector.spec.ts` /
 * `e2e/partner-auth.spec.ts`: live route guards only — no pure decision logic was
 * added this sprint (`lib/partner-grant-server.ts#autoGrantPartnerOnClose` is a
 * thin Supabase read-modify-write with no branchy pure core worth unit-testing in
 * isolation; its behavior is the Sprint-2 smoke walkthrough, steps 1–2).
 *
 * NOT covered here (owed to Daniel — sprint-2.md smoke walkthrough): the real
 * grant-lifecycle round-trip (close → grant exists → MCP reaches the shop →
 * seller revoke → next call denied) needs a real bound promoter with a partner
 * credential and a real seller session — no fixture for either exists in this
 * harness (the standing gap every partner/agent spec in this repo notes).
 *
 * Red-observed mechanism (stated for the PR, per the red-green rule): NONE of
 * this sprint's routes exist yet on `main`/prod (Sprint 1 is still an open,
 * unmerged PR) — `GET/DELETE /api/sell/partner-grants` and `/partner` 404
 * TODAY via Next's generic catch-all (confirmed live: `content-type: text/html`,
 * a full rendered not-found page). Once this ships, the SAME anonymous request
 * still 404s (flag `partners.mcp_enabled` defaults OFF) — but from a REAL route,
 * returning a JSON body with `content-type: application/json`. That content-type
 * flip is the deterministic red→green signal for the two API tests below; it's
 * a genuine assertion failure against prod today, not a vacuous 404 == 404 match.
 *
 * `/partner` itself has no equivalent signal: gated by the SAME flag, a
 * `notFound()` call inside `page.tsx` renders through the SAME generic
 * not-found boundary Next already serves for an unmatched route — so its 404
 * response is byte-for-byte indistinguishable before and after this ships,
 * while the flag stays off (which it does — Sprint 1 hasn't had its smoke
 * walkthrough yet, the prerequisite for any flip). That page's guard is
 * asserted below for completeness (never 200 anonymously without a bound
 * promoter, whatever the flag state) but is NOT the red-observed evidence —
 * documented here rather than silently claimed.
 */

test.describe('partner-grants · GET /api/sell/partner-grants is a real JSON route', () => {
  test('anonymous GET → 401 or 404, but a genuine JSON response (not the generic HTML 404 page)', async ({ request }) => {
    const res = await request.get('/api/sell/partner-grants')
    expect([401, 404]).toContain(res.status())
    expect(res.headers()['content-type'] ?? '').toContain('application/json')
  })
})

test.describe('partner-grants · DELETE /api/sell/partner-grants is a real JSON route', () => {
  test('anonymous DELETE (revoke) → 401 or 404, but a genuine JSON response', async ({ request }) => {
    const res = await request.delete('/api/sell/partner-grants', {
      data: { grant_id: 'nonexistent' },
    })
    expect([401, 404]).toContain(res.status())
    expect(res.headers()['content-type'] ?? '').toContain('application/json')
  })

  test('a missing grant_id body never 500s while anonymous (flag/auth gate short-circuits first)', async ({ request }) => {
    // Can't authenticate here (no seller fixture) — this ONLY proves the route
    // never 5xx's on a garbage body while it's still resolving the flag/auth
    // gate (401/404). It does NOT exercise the grant_id validation branch
    // itself — that requires a real authed seller session (owed to Daniel,
    // see the file header and sprint-2.md's smoke walkthrough).
    const res = await request.delete('/api/sell/partner-grants', { data: {} })
    expect(res.status()).toBeLessThan(500)
  })
})

test.describe('partner-grants · GET /partner dashboard never leaks without a session', () => {
  test('anonymous GET → never 200 (flag off ⇒ 404; flag on ⇒ redirected to /sign-in, never a 200 page)', async ({ request }) => {
    const res = await request.get('/partner', { maxRedirects: 0 }).catch(() => null)
    // Some environments may follow the redirect anyway depending on fixture setup;
    // the only cross-environment-safe invariant is "never a bare 200 render for an
    // anonymous caller" — 404 (flag off) or a 3xx to /sign-in (flag on) both satisfy it.
    if (res) {
      expect(res.status()).not.toBe(200)
    }
  })
})
