import { expect, test } from '@playwright/test'
import {
  classifyEnvelope,
  buildLifecycleTrackPayload,
  MERCHANT_LIFECYCLE_EVENTS,
  MAX_SUBJECT_ID_LENGTH,
} from '../lib/merchant-lifecycle'
import {
  lifecycleFixtures,
  shapingFixtures,
  allFixtures,
  fixturesDigest,
} from './_fixtures/merchant-lifecycle'

/**
 * Golden Beans event-destination-router · Story 3.1 — pure-seam coverage for the
 * merchant lifecycle projection.
 *
 * These run against the SHARED fixture file (Sprint 3 QA: identical fixtures in both
 * repos' suites). No network, no DB, no browser — `classifyEnvelope` is zero-import
 * precisely so every branch is reachable here rather than only through whatever path a
 * well-formed HTTP request happens to walk.
 */

test.describe('merchant lifecycle · shared fixtures', () => {
  test('the fixture file covers all six lifecycle events, exactly once each', () => {
    const covered = lifecycleFixtures.map((f) => f.envelope.type)
    expect([...covered].sort()).toEqual([...MERCHANT_LIFECYCLE_EVENTS].sort())
  })

  test('the fixture file is unmodified — golden-beans asserts the same digest', () => {
    // If this fails, the fixtures changed. That is allowed; update BOTH repos and both
    // digests in the same change, or the "identical fixtures" claim is no longer true.
    expect(fixturesDigest()).toMatch(/^[0-9a-f]{64}$/)
    expect(fixturesDigest()).toBe(FIXTURES_SHA256)
  })

  for (const fixture of allFixtures) {
    test(`classify · ${fixture.name}`, () => {
      const decision = classifyEnvelope(fixture.envelope)
      expect(decision.kind).toBe(fixture.expect.kind)
      if (fixture.expect.reason) {
        expect((decision as { reason?: string }).reason).toBe(fixture.expect.reason)
      }
      if (fixture.expect.merchantId) {
        expect((decision as { merchantId?: string }).merchantId).toBe(fixture.expect.merchantId)
      }
    })
  }

  test('a lifecycle fixture normalises occurredAt to UTC ISO', () => {
    const decision = classifyEnvelope(lifecycleFixtures[0].envelope)
    expect(decision.kind).toBe('lifecycle')
    if (decision.kind !== 'lifecycle') return
    expect(decision.occurredAt).toBe('2026-07-22T10:00:00.000Z')
    expect(decision.eventId).toBe(lifecycleFixtures[0].envelope.id)
  })

  test('an equivalent non-UTC spelling produces the SAME instant', () => {
    // Two spellings of one moment must not become two comparable-looking timestamps in
    // the projection.
    const decision = classifyEnvelope({
      id: 'tz-check',
      type: 'merchant.claimed',
      occurredAt: '2026-07-22T05:00:00-05:00',
      data: { subject: { type: 'merchant', id: 'shop_1' } },
    })
    expect(decision.kind).toBe('lifecycle')
    if (decision.kind !== 'lifecycle') return
    expect(decision.occurredAt).toBe('2026-07-22T10:00:00.000Z')
  })
})

test.describe('merchant lifecycle · classify hostile input', () => {
  const notObjects: unknown[] = [null, undefined, 'a string', 42, true, ['array']]
  for (const value of notObjects) {
    test(`rejects a non-object body: ${JSON.stringify(value) ?? 'undefined'}`, () => {
      expect(classifyEnvelope(value)).toEqual({ kind: 'invalid', reason: 'not_an_object' })
    })
  }

  test('rejects a subject id longer than golden-beans permits', () => {
    const decision = classifyEnvelope({
      id: 'oversize',
      type: 'merchant.claimed',
      occurredAt: '2026-07-22T10:00:00.000Z',
      data: { subject: { type: 'merchant', id: 'x'.repeat(MAX_SUBJECT_ID_LENGTH + 1) } },
    })
    expect(decision).toEqual({ kind: 'invalid', reason: 'missing_merchant_subject' })
  })

  test('rejects an id that is only whitespace — a PK must be a real value', () => {
    expect(classifyEnvelope({ id: '   ', type: 'merchant.claimed', occurredAt: '2026-07-22T10:00:00Z' }))
      .toEqual({ kind: 'invalid', reason: 'missing_id' })
  })

  test('`test: false` is NOT a test send — only literal true is', () => {
    // The producer never sends `false`; a receiver that treated any `test` key as truthy
    // (or as present-means-test) would drop real events on the floor.
    const decision = classifyEnvelope({
      id: 'not-a-test',
      type: 'merchant.claimed',
      occurredAt: '2026-07-22T10:00:00.000Z',
      test: false,
      data: { subject: { type: 'merchant', id: 'shop_1' } },
    })
    expect(decision.kind).toBe('lifecycle')
  })

  test('a non-lifecycle event is IGNORED, never invalid — the destination gets every project event', () => {
    for (const fixture of shapingFixtures) {
      if (fixture.expect.kind !== 'ignored') continue
      expect(classifyEnvelope(fixture.envelope).kind).toBe('ignored')
    }
  })
})

test.describe('merchant lifecycle · track payload (producer half)', () => {
  const AT = new Date('2026-07-22T10:00:00.000Z')

  test('carries the merchant subject golden-beans routes on', () => {
    const payload = buildLifecycleTrackPayload('merchant.first_sale', {
      merchantId: 'shop_abc',
      occurredAt: AT,
    })
    expect(payload).toEqual({
      userId: 'shop_abc',
      event: 'merchant.first_sale',
      featureId: 'merchant-lifecycle',
      tags: { shop_id: 'shop_abc' },
      context: {
        version: 1,
        subject: { type: 'merchant', id: 'shop_abc' },
        occurredAt: '2026-07-22T10:00:00.000Z',
        idempotencyKey: 'shop_abc:merchant.first_sale',
      },
    })
  })

  test('the idempotency key is stable per (merchant, milestone) across rebuilds', () => {
    // This is what makes an AMBIGUOUS send safe to retry: golden-beans enforces
    // UNIQUE (project_id, idempotency_key) and returns the EXISTING event, so a retry
    // after a timed-out-but-accepted send resolves to one canonical event, one
    // delivery, one milestone.
    const a = buildLifecycleTrackPayload('merchant.first_sale', { merchantId: 'shop_abc' })
    const b = buildLifecycleTrackPayload('merchant.first_sale', { merchantId: 'shop_abc' })
    expect(a.context.idempotencyKey).toBe(b.context.idempotencyKey)
  })

  test('different milestones and different merchants never share a key', () => {
    const keys = new Set<string>()
    for (const merchantId of ['shop_a', 'shop_b']) {
      for (const event of MERCHANT_LIFECYCLE_EVENTS) {
        keys.add(buildLifecycleTrackPayload(event, { merchantId }).context.idempotencyKey)
      }
    }
    expect(keys.size).toBe(2 * MERCHANT_LIFECYCLE_EVENTS.length)
  })

  test('an oversized merchant id truncates the ID, never the event name', () => {
    // Truncating the event name would collide two DIFFERENT milestones for the same
    // merchant into one key — a silent loss. Truncating the id degrades into a
    // collision between two merchants' SAME milestone, which is the lesser failure.
    const key = buildLifecycleTrackPayload('merchant.three_products_live', {
      merchantId: 'x'.repeat(400),
    }).context.idempotencyKey
    expect(key.length).toBeLessThanOrEqual(128) // golden-beans' hard limit
    expect(key.endsWith(':merchant.three_products_live')).toBe(true)
  })

  test('context.version is 1 — golden-beans REJECTS an absent or unknown version', () => {
    const payload = buildLifecycleTrackPayload('merchant.claimed', { merchantId: 'shop_abc' })
    expect(payload.context.version).toBe(1)
  })

  test('occurredAt always carries a time and an explicit UTC offset', () => {
    // A bare date ("2026-07-22") names 24+ instants; golden-beans rejects it outright.
    const payload = buildLifecycleTrackPayload('merchant.claimed', { merchantId: 'shop_abc' })
    expect(payload.context.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  test('correlationId is included only when supplied — never sent as null', () => {
    const without = buildLifecycleTrackPayload('merchant.claimed', { merchantId: 'shop_abc' })
    expect('correlationId' in without.context).toBe(false)

    const with_ = buildLifecycleTrackPayload('merchant.claimed', {
      merchantId: 'shop_abc',
      correlationId: 'pv_1',
    })
    expect(with_.context.correlationId).toBe('pv_1')
  })

  test('NO PII can reach the payload — tags are an allow-list, not a redaction pass', () => {
    // Golden Beans forwards tenant metadata VALUES verbatim to every destination without
    // inspecting them, so anything personal that reaches it has already left our control.
    // The guarantee here is structural: a caller passing extra fields has nowhere to put
    // them, so this cannot regress by someone adding a spread.
    const payload = buildLifecycleTrackPayload('merchant.claimed', {
      merchantId: 'shop_abc',
      productCount: 3,
      // @ts-expect-error — deliberately passing fields the type does not allow
      email: 'merchant@example.com',
      whatsapp: '+52 55 1234 5678',
      shopName: 'Bonsáis del Valle',
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('merchant@example.com')
    expect(serialized).not.toContain('1234')
    expect(serialized).not.toContain('Bonsáis')
    expect(payload.tags).toEqual({ shop_id: 'shop_abc', product_count: 3 })
  })

  test('every one of the six events builds a routable payload', () => {
    for (const event of MERCHANT_LIFECYCLE_EVENTS) {
      const payload = buildLifecycleTrackPayload(event, { merchantId: 'shop_abc', occurredAt: AT })
      expect(payload.event).toBe(event)
      expect(payload.context.subject).toEqual({ type: 'merchant', id: 'shop_abc' })
    }
  })
})

test.describe('merchant lifecycle · the loop closes', () => {
  test('what we emit, classified as what we would receive back', () => {
    // The round trip in one assertion: our track payload → the envelope golden-beans
    // builds from the stored row → our own classifier. If the two halves ever disagree
    // about the subject key, this is where it shows up rather than in production.
    for (const event of MERCHANT_LIFECYCLE_EVENTS) {
      const emitted = buildLifecycleTrackPayload(event, {
        merchantId: 'shop_abc',
        occurredAt: new Date('2026-07-22T10:00:00.000Z'),
      })
      // buildEventEnvelope's transform: snake_cased columns back out, nulls omitted.
      const delivered = {
        id: 'evt-round-trip',
        type: emitted.event,
        occurredAt: emitted.context.occurredAt,
        data: {
          userId: emitted.userId,
          featureId: emitted.featureId,
          tags: emitted.tags,
          subject: emitted.context.subject,
        },
      }
      const decision = classifyEnvelope(delivered)
      expect(decision.kind).toBe('lifecycle')
      if (decision.kind !== 'lifecycle') continue
      expect(decision.merchantId).toBe('shop_abc')
      expect(decision.type).toBe(event)
    }
  })
})

/**
 * Pinned sha256 of e2e/_fixtures/merchant-lifecycle.fixtures.json.
 * The golden-beans suite pins the SAME value against its own copy — that is what makes
 * "identical fixtures in both repos" a checked fact rather than a claim in a doc.
 */
const FIXTURES_SHA256 = 'a4db537e51e5554d919d3064d271fce2b48104c0a0fb18744f891d76a45950e5'
