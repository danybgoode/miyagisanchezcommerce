import { expect, test } from '@playwright/test'
import { lifecycleFixtures, shapingFixtures, serializeEnvelope } from './_fixtures/merchant-lifecycle'

/**
 * `POST /api/webhooks/golden-beans` · HTTP-level gate (Golden Beans
 * event-destination-router · Story 3.1).
 *
 * This spec runs ANONYMOUSLY against the deployed target, so it cannot produce a valid
 * signature — the signing secret is deployment-only and never in the repo. What it CAN
 * prove, and what matters most, is that the endpoint refuses everything unsigned. The
 * accept path and every classification branch are covered directly in
 * `merchant-lifecycle.spec.ts` and `gb-webhook-signature.spec.ts`, which is why those
 * are pure-seam specs rather than HTTP ones.
 *
 * A 401 here is the contract-correct answer AND the fail-closed answer when
 * GOLDEN_BEANS_WEBHOOK_SECRET is unset — the two are indistinguishable from outside on
 * purpose, so an unconfigured deploy can never be probed into looking open.
 */

const ENDPOINT = '/api/webhooks/golden-beans'
const BODY = serializeEnvelope(lifecycleFixtures[1].envelope)

test.describe('gb webhook endpoint · rejects everything unsigned', () => {
  test('no signature header → 401, and nothing is projected', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json' },
      data: BODY,
    })
    expect(res.status()).toBe(401)
  })

  test('a forged signature → 401', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'X-GB-Signature': `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}`,
      },
      data: BODY,
    })
    expect(res.status()).toBe(401)
  })

  test('a malformed signature header → 401', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'X-GB-Signature': 'garbage' },
      data: BODY,
    })
    expect(res.status()).toBe(401)
  })

  test('the rejection leaks no oracle — no reason, no secret, no target', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'X-GB-Signature': 'garbage' },
      data: BODY,
    })
    const text = await res.text()
    expect(text).not.toMatch(/malformed_header|bad_signature|stale_timestamp/)
    expect(text).not.toContain('whsec_')
  })

  test('signature is checked BEFORE the body is parsed — invalid JSON still 401s, never 400', async ({
    request,
  }) => {
    // A 400 here would prove the endpoint parsed an unauthenticated body first, which is
    // the ordering bug this whole route is built to avoid.
    const res = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not json at all',
    })
    expect(res.status()).toBe(401)
  })

  test('an unsigned TEST envelope is refused like any other', async ({ request }) => {
    const testFixture = shapingFixtures.find((f) => f.expect.kind === 'test')!
    const res = await request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json' },
      data: serializeEnvelope(testFixture.envelope),
    })
    expect(res.status()).toBe(401)
  })

  test('GET is not a delivery method', async ({ request }) => {
    const res = await request.get(ENDPOINT)
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})
