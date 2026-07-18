import { expect, test } from '@playwright/test'

// Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 3 · US-3.1) —
// the HTTP contract for POST /api/comparador/analyze: validation + SSRF
// rejection ALWAYS happens before any real outbound fetch, and the rate limit
// runs first of all. Deliberately never sends a URL that would actually be
// fetched (no live third-party request from CI — same restraint as
// e2e/launchpad-submission.spec.ts not exercising a real upload). Every case
// below is rejected pre-fetch, so this is safe to run against any environment,
// live or local, without side effects, cost, or flakiness.
//
// The rate-limiter itself only engages when UPSTASH_REDIS_REST_URL/TOKEN are
// configured (lib/ratelimit.ts fails open otherwise) — mirrors
// e2e/launchpad-submission.spec.ts's `[423, 429]` acceptance pattern: assert
// the request never reaches real work, accepting either the validation
// rejection OR a 429 if the limiter happens to be armed in this environment.

test.describe('POST /api/comparador/analyze · validation degrades gracefully, never 500', () => {
  test('missing url → 422, friendly es-MX message', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: {} })
    expect([422, 429]).toContain(res.status())
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  test('genuinely unparseable JSON body → 400, not 500', async ({ request }) => {
    // A bare string like `data: 'not json'` actually serializes to a VALID JSON
    // string literal (`"not json"`) via Playwright's `data` option — `req.json()`
    // parses it fine, it's just not an object, so the route's own `!url` guard
    // (not the JSON.parse catch) handles it → 422, not 400. To hit the actual
    // `req.json()` throw path this route's `catch` guards, send raw bytes that
    // aren't valid JSON at all.
    const res = await request.post('/api/comparador/analyze', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{this is not valid json'),
    })
    expect([400, 422, 429]).toContain(res.status())
  })

  test('a non-https URL is rejected before any fetch (422)', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: { url: 'http://example.com' } })
    expect([422, 429]).toContain(res.status())
  })

  test('a bare IPv4 literal is rejected before any fetch (SSRF shape check, 422)', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: { url: 'https://127.0.0.1/' } })
    expect([422, 429]).toContain(res.status())
  })

  test('localhost is rejected before any fetch (422)', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: { url: 'https://localhost/' } })
    expect([422, 429]).toContain(res.status())
  })

  test('a private-range hostname-shaped IP literal (link-local) is rejected (422)', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: { url: 'https://169.254.169.254/' } })
    expect([422, 429]).toContain(res.status())
  })

  test('a malformed URL string → 422, not a thrown 500', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: { url: 'not a url at all' } })
    expect([422, 429]).toContain(res.status())
  })

  test('an absurdly long URL is rejected on length before any parsing/fetch (422)', async ({ request }) => {
    const longUrl = 'https://example.com/' + 'a'.repeat(3000)
    const res = await request.post('/api/comparador/analyze', { data: { url: longUrl } })
    expect([422, 429]).toContain(res.status())
  })

  test('every rejection path returns JSON with an `error` string — the client always has something to show', async ({ request }) => {
    const res = await request.post('/api/comparador/analyze', { data: { url: 'https://127.0.0.1/' } })
    const body = await res.json().catch(() => null)
    expect(body).not.toBeNull()
    expect(typeof body.error).toBe('string')
  })
})

test.describe('POST /api/comparador/analyze · burst → friendly degrade (rate-limit acceptance)', () => {
  test('rapid repeated calls never 500 — each is either a controlled validation rejection or a 429', async ({ request }) => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        request.post('/api/comparador/analyze', { data: { url: 'https://127.0.0.1/' } }),
      ),
    )
    for (const res of results) {
      expect([422, 429]).toContain(res.status())
      const body = await res.json().catch(() => null)
      expect(body).not.toBeNull()
      expect(typeof body.error).toBe('string')
    }
  })
})
