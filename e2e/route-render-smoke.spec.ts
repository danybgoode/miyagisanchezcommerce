import { expect, test } from '@playwright/test'

/**
 * Every market-critical route must actually RENDER — blocking.
 *
 * A server component calling a client hook builds, type-checks and lints clean and
 * throws only at request time. On 2026-08-11 that shipped: `/mx/l` and `/us/l` both
 * 500'd in production while all four API shards were green, because nothing in the
 * deterministic gate ever rendered a page. The browser-smoke job is
 * `continue-on-error: true`, so it could not have failed the gate either.
 *
 * These specs live in the BLOCKING api project (same seam as agent-readability's
 * live fetches) and hit PLAYWRIGHT_BASE_URL — the preview on a PR. They assert only
 * data-independent facts, so no fixture or catalog state can make them flaky: an
 * empty catalog is a perfectly good render.
 */

/** A rendered page that failed server-side, independent of any catalog contents. */
export interface RenderFault { readonly kind: string; readonly detail: string }

/**
 * PURE: classify a fetched page. Kept free of the network so the failure modes are
 * unit-testable against captured bodies — including the real one from the outage.
 *
 * Deliberately NOT matching a bare "500": listing prices legitimately contain it
 * ("$500.00"). A guard that rejects correct output trains people to bypass it.
 */
export function classifyRenderedPage(
  status: number,
  body: string,
  expected: { readonly lang?: string } = {},
): RenderFault[] {
  const faults: RenderFault[] = []
  if (status !== 200) faults.push({ kind: 'status', detail: `expected 200, got ${status}` })

  const clientHook = body.match(/Attempted to call (\w+)\(\) from the server/)
  if (clientHook) faults.push({ kind: 'client_hook_on_server', detail: clientHook[1] })

  if (body.includes('Application error: a server-side exception has occurred')) {
    faults.push({ kind: 'server_exception', detail: "Next's client-facing error page" })
  }
  // Next's digest-only production error page: no message, just a digest reference.
  if (/<h[12][^>]*>\s*(500|Internal Server Error)\s*</i.test(body)) {
    faults.push({ kind: 'error_page', detail: 'rendered an error page heading' })
  }

  if (expected.lang) {
    const lang = body.match(/<html[^>]*\slang="([^"]*)"/)
    if (!lang) faults.push({ kind: 'lang_missing', detail: 'no <html lang>' })
    else if (lang[1] !== expected.lang) {
      faults.push({ kind: 'lang_mismatch', detail: `expected ${expected.lang}, got ${lang[1]}` })
    }
  }
  return faults
}

/**
 * The market × route matrix, enumerated rather than hand-picked. A new market or a
 * new buyer route belongs here; that is the point — the population is the guard.
 */
const CRITICAL_ROUTES: ReadonlyArray<{ path: string; lang?: string; note: string }> = [
  { path: '/', note: 'master-brand market selector' },
  { path: '/mx', lang: 'es-MX', note: 'MX marketplace home' },
  { path: '/mx/l', lang: 'es-MX', note: 'MX browse — 500’d on 2026-08-11' },
  { path: '/us', lang: 'en-US', note: 'US marketplace home' },
  { path: '/us/l', lang: 'en-US', note: 'US browse — 500’d on 2026-08-11' },
]

test.describe('route render smoke · every market-critical route renders', () => {
  for (const route of CRITICAL_ROUTES) {
    test(`${route.path} renders (${route.note})`, async ({ request }) => {
      const res = await request.get(route.path)
      const faults = classifyRenderedPage(res.status(), await res.text(), { lang: route.lang })
      expect(faults.map((f) => `${f.kind}: ${f.detail}`)).toEqual([])
    })
  }
})

test.describe('route render smoke · classifier fixtures (prove the guard bites)', () => {
  // Verbatim shape of the body Next served during the outage.
  const OUTAGE_BODY = '<html lang="es-MX"><body>Error: Attempted to call useBuyerPresentation() from the server but useBuyerPresentation is on the client.</body></html>'

  test('negative fixture: the real outage body is caught', () => {
    const faults = classifyRenderedPage(500, OUTAGE_BODY, { lang: 'es-MX' })
    expect(faults.map((f) => f.kind)).toContain('client_hook_on_server')
    expect(faults.map((f) => f.kind)).toContain('status')
    expect(faults.find((f) => f.kind === 'client_hook_on_server')?.detail).toBe('useBuyerPresentation')
  })

  test('negative fixture: a wrong-language render is caught', () => {
    const faults = classifyRenderedPage(200, '<html lang="es-MX"></html>', { lang: 'en-US' })
    expect(faults.map((f) => f.kind)).toEqual(['lang_mismatch'])
  })

  test('negative fixture: Next’s generic server-exception page is caught', () => {
    const body = '<html lang="es-MX">Application error: a server-side exception has occurred</html>'
    expect(classifyRenderedPage(200, body).map((f) => f.kind)).toEqual(['server_exception'])
  })

  // Always allow the negation of what we ban.
  test('positive fixture: an EMPTY but healthy catalog page is green', () => {
    const body = '<html lang="en-US"><body><div data-testid="market-catalog-unavailable">The marketplace is taking shape</div></body></html>'
    expect(classifyRenderedPage(200, body, { lang: 'en-US' })).toEqual([])
  })

  test('positive fixture: a $500.00 price is not mistaken for an HTTP 500', () => {
    const body = '<html lang="es-MX"><body><p class="t-price">$500.00</p><h1>500 resultados</h1></body></html>'
    expect(classifyRenderedPage(200, body, { lang: 'es-MX' })).toEqual([])
  })
})
