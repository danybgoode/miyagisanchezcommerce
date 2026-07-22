import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyWebhookSignature,
  signWebhookPayload,
  SIGNATURE_TOLERANCE_SECONDS,
} from '../lib/webhook-signature'
import { lifecycleFixtures, serializeEnvelope } from './_fixtures/merchant-lifecycle'

/**
 * Golden Beans event-destination-router · Story 3.1 — signature verification.
 *
 * MUTATION-CHECKED, by actually running it. A signature spec that only asserts the
 * happy path passes against a verifier that returns `{ ok: true }` unconditionally,
 * which is the single worst possible bug in this file and the one a green suite would
 * hide. Four mutations were introduced into lib/webhook-signature.ts and the suite
 * re-run; the observed results:
 *
 *   - `return { ok: true }` always            → 20 of 25 specs FAIL
 *   - `if (false)` on the timestamp window    → 3 FAIL (stale, future, replay-outside)
 *   - sign `body` instead of `${t}.${body}`   → 3 FAIL (tampered timestamp, KAT vector)
 *   - `a === b` instead of timingSafeEqual    → 0 fail. Timing is NOT observable from a
 *                                               spec, so behaviour cannot catch it. That
 *                                               is why the last test in this file asserts
 *                                               the SHAPE of the comparison in the source
 *                                               instead — the only check that closes it.
 *
 * The verifier under test is a VERBATIM copy of golden-beans' producer-side
 * implementation. The fixtures are signed with the copied signer, so a divergence in
 * either direction shows up here.
 */

const SECRET = 'whsec_test_5f3c9a1b2d4e6f8a0c2e4b6d8f0a2c4e'
const WRONG_SECRET = 'whsec_test_0000000000000000000000000000000000'
const NOW = 1_800_000_000 // fixed clock — the window branches are untestable against Date.now()

const BODY = serializeEnvelope(lifecycleFixtures[1].envelope) // preview_approved

test.describe('gb webhook signature · accepts a genuine delivery', () => {
  test('a correctly signed body verifies', () => {
    const header = signWebhookPayload(SECRET, BODY, NOW)
    expect(verifyWebhookSignature(SECRET, BODY, header, NOW)).toEqual({ ok: true })
  })

  test('all six lifecycle fixtures verify against their own signatures', () => {
    for (const fixture of lifecycleFixtures) {
      const body = serializeEnvelope(fixture.envelope)
      const header = signWebhookPayload(SECRET, body, NOW)
      expect(verifyWebhookSignature(SECRET, body, header, NOW), fixture.name).toEqual({ ok: true })
    }
  })

  test('the signature is HMAC-SHA256 over `${t}.${rawBody}` — not over the body alone', () => {
    // Pins the signed material independently of our own signer, so "both halves are
    // wrong in the same way" is not a passing state.
    const expected = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex')
    expect(signWebhookPayload(SECRET, BODY, NOW)).toBe(`t=${NOW},v1=${expected}`)

    const bodyOnly = createHmac('sha256', SECRET).update(BODY).digest('hex')
    expect(verifyWebhookSignature(SECRET, BODY, `t=${NOW},v1=${bodyOnly}`, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })
})

test.describe('gb webhook signature · REJECTS', () => {
  test('wrong secret', () => {
    const header = signWebhookPayload(WRONG_SECRET, BODY, NOW)
    expect(verifyWebhookSignature(SECRET, BODY, header, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  test('tampered body — one byte changed after signing', () => {
    const header = signWebhookPayload(SECRET, BODY, NOW)
    const tampered = BODY.replace(
      '11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999999',
    )
    expect(tampered).not.toBe(BODY)
    expect(verifyWebhookSignature(SECRET, tampered, header, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  test('tampered body — whitespace only (why the RAW bytes must be verified, not a re-serialized object)', () => {
    // `JSON.parse` then `JSON.stringify` of a pretty-printed body yields different bytes
    // for an identical object. Verifying the re-serialized form fails exactly like this,
    // and looks like a producer bug.
    const header = signWebhookPayload(SECRET, BODY, NOW)
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2)
    expect(verifyWebhookSignature(SECRET, reserialized, header, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  test('tampered timestamp — a valid signature re-labelled with a fresh `t`', () => {
    // The attack the `${t}.${body}` construction exists to stop: capture a valid
    // delivery, move its timestamp forward to escape the window, keep the signature.
    const genuine = signWebhookPayload(SECRET, BODY, NOW - 10_000)
    const sig = genuine.split('v1=')[1]
    const relabelled = `t=${NOW},v1=${sig}`
    expect(verifyWebhookSignature(SECRET, BODY, relabelled, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  test('stale timestamp — outside the 300s tolerance', () => {
    const header = signWebhookPayload(SECRET, BODY, NOW - SIGNATURE_TOLERANCE_SECONDS - 1)
    expect(verifyWebhookSignature(SECRET, BODY, header, NOW)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    })
  })

  test('future timestamp — the window is absolute, not one-sided', () => {
    const header = signWebhookPayload(SECRET, BODY, NOW + SIGNATURE_TOLERANCE_SECONDS + 1)
    expect(verifyWebhookSignature(SECRET, BODY, header, NOW)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    })
  })

  test('a byte-perfect REPLAY is accepted inside the window and rejected outside it', () => {
    // This is the whole security property of the timestamp: a captured delivery is
    // valid forever without it. Inside the window a replay IS accepted — that is by
    // design, and it is why idempotency by event id is a separate, contractual
    // requirement rather than something the signature can provide.
    const captured = signWebhookPayload(SECRET, BODY, NOW)
    expect(verifyWebhookSignature(SECRET, BODY, captured, NOW + 60)).toEqual({ ok: true })
    expect(verifyWebhookSignature(SECRET, BODY, captured, NOW + SIGNATURE_TOLERANCE_SECONDS + 1)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    })
  })

  const malformed: Array<[string, string]> = [
    ['empty header', ''],
    ['missing t', `v1=${'a'.repeat(64)}`],
    ['missing v1', `t=${NOW}`],
    ['non-numeric t', `t=17x,v1=${'a'.repeat(64)}`],
    ['float t', `t=${NOW}.5,v1=${'a'.repeat(64)}`],
    ['negative t', `t=-${NOW},v1=${'a'.repeat(64)}`],
    ['signature too short', `t=${NOW},v1=${'a'.repeat(63)}`],
    ['signature too long', `t=${NOW},v1=${'a'.repeat(65)}`],
    ['signature not hex', `t=${NOW},v1=${'z'.repeat(64)}`],
    ['uppercase hex (producer emits lowercase)', `t=${NOW},v1=${'A'.repeat(64)}`],
    ['scheme v2', `t=${NOW},v2=${'a'.repeat(64)}`],
    ['no separators at all', 'garbage'],
  ]
  for (const [name, header] of malformed) {
    test(`malformed header · ${name}`, () => {
      expect(verifyWebhookSignature(SECRET, BODY, header, NOW)).toEqual({
        ok: false,
        reason: 'malformed_header',
      })
    })
  }

  test('a malformed header is rejected BEFORE the signature is even computed', () => {
    // Length-mismatched input reaching timingSafeEqual would THROW (an observable
    // signal in itself). The parse gate is what prevents that, so it must reject
    // rather than fall through.
    expect(() => verifyWebhookSignature(SECRET, BODY, 't=1,v1=short', NOW)).not.toThrow()
  })
})

test.describe('gb webhook signature · the copy has not drifted from the producer', () => {
  test('tolerance is exactly the 300s the contract names', () => {
    // A receiver may widen this; it must never be unbounded, and it must never quietly
    // differ from the number the contract and golden-beans both publish.
    expect(SIGNATURE_TOLERANCE_SECONDS).toBe(300)
  })

  test('the comparison is constant-time — asserted on the SOURCE, because behaviour cannot', () => {
    // The one property no black-box test can reach: a `===` compare returns the right
    // answer every time and leaks, via timing, how many leading bytes of a forged
    // signature were correct — enough to forge one given enough attempts. A mutation to
    // `a === b` was run against this whole file and broke nothing. So this reads the
    // source, the same way the repo's other structural guards do.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'webhook-signature.ts'),
      'utf8',
    )
    expect(source).toContain('timingSafeEqual')
    // No early-exit comparison of the two hex digests.
    expect(source).not.toMatch(/expected\s*===\s*parsed\.signature/)
    expect(source).not.toMatch(/parsed\.signature\s*===\s*expected/)
    // The length pre-check must survive: timingSafeEqual THROWS on a length mismatch,
    // and a thrown 500 is itself an observable signal.
    expect(source).toContain('a.length !== b.length')
  })

  test('a known-answer vector — pins the scheme against a hardcoded expectation', () => {
    // Independent of both our signer and our verifier: if this changes, the wire format
    // changed, and every previously-signed delivery would now fail.
    const vector = createHmac('sha256', 'secret').update('1700000000.{"a":1}').digest('hex')
    expect(signWebhookPayload('secret', '{"a":1}', 1_700_000_000)).toBe(`t=1700000000,v1=${vector}`)
    expect(verifyWebhookSignature('secret', '{"a":1}', `t=1700000000,v1=${vector}`, 1_700_000_000)).toEqual({
      ok: true,
    })
  })
})
