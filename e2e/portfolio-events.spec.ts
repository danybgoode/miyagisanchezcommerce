import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MERCHANT_LIFECYCLE_EVENTS } from '../lib/merchant-lifecycle'
import {
  buildPortfolioEventPayload,
  EXCLUDED_EVENT_SOURCE_KEYS,
  isPortfolioLifecycleEvent,
  PORTFOLIO_LIFECYCLE_EVENTS,
  portfolioEventDedupeKey,
  portfolioEventIdempotencyKey,
  type PortfolioEventSourceInput,
} from '../lib/portfolio/events'

/**
 * Merchant Partner lifecycle · Sprint 3, Story 3.3 (api project, network-free):
 * PII-free SLA/retention events (README D8, D9).
 *
 * Four things are proven here:
 *   1. `PORTFOLIO_LIFECYCLE_EVENTS` is its OWN vocabulary, DISJOINT from
 *      `MERCHANT_LIFECYCLE_EVENTS` (the consumer's accept-list) — D8.
 *   2. `buildPortfolioEventPayload` is a POSITIVE-list builder — a
 *      fully-populated, PII-carrying fixture never leaks into the payload —
 *      D9, the load-bearing spec of this story.
 *   3. The dedupe/idempotency keys are deterministic and per-occurrence,
 *      never collapsing two different windows into one key.
 *   4. THE MILESTONE PATH STAYS BYTE-IDENTICAL after the D8 PK widening —
 *      proven at the source-text layer (no live DB in this project), by
 *      asserting `deliverClaimedEmission`'s `dedupeKey` default is `''` and
 *      that the widened predicate/select/drain wiring exists exactly where
 *      the build contract says it must.
 *
 * RED-OBSERVED (red-green DoD): the D9 payload test was watched fail against
 * a deliberately-reintroduced `...(input as unknown as Record<string, unknown>)`
 * spread inside `buildPortfolioEventPayload` (which leaked `businessName`/
 * `phoneE164` into `tags`), then re-run green after removing it. The
 * disjointness test was watched fail against a scratch copy of
 * `lib/portfolio/events.ts` with `merchant.claimed` appended to
 * `PORTFOLIO_LIFECYCLE_EVENTS`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

test.describe('D8 — PORTFOLIO_LIFECYCLE_EVENTS is its OWN emit-only vocabulary', () => {
  test('the six event names are exact', () => {
    expect([...PORTFOLIO_LIFECYCLE_EVENTS].sort()).toEqual(
      [
        'merchant.retention_outcome_recorded',
        'merchant.retention_scheduled',
        'merchant.sla_completed',
        'merchant.sla_due',
        'merchant.sla_overdue',
        'merchant.steward_assigned',
      ].sort(),
    )
  })

  test('isPortfolioLifecycleEvent accepts only the six, rejects garbage and a milestone event', () => {
    for (const e of PORTFOLIO_LIFECYCLE_EVENTS) expect(isPortfolioLifecycleEvent(e), e).toBe(true)
    expect(isPortfolioLifecycleEvent('merchant.claimed')).toBe(false)
    expect(isPortfolioLifecycleEvent('not_an_event')).toBe(false)
    expect(isPortfolioLifecycleEvent(null)).toBe(false)
  })

  test('DISJOINT from MERCHANT_LIFECYCLE_EVENTS — never appended to the consumer accept-list', () => {
    const overlap = PORTFOLIO_LIFECYCLE_EVENTS.filter((e) => (MERCHANT_LIFECYCLE_EVENTS as readonly string[]).includes(e))
    expect(overlap).toEqual([])
  })

  test('lib/portfolio/events.ts does not import lib/merchant-lifecycle.ts — the two vocabularies stay independent at the TYPE level too', () => {
    const source = read('lib/portfolio/events.ts')
    expect(source).not.toMatch(/from ['"]@\/lib\/merchant-lifecycle['"]/)
  })
})

test.describe('D9 — THE LOAD-BEARING SPEC: the payload allowlist is positive, PII-free by construction', () => {
  const fullyPopulated: PortfolioEventSourceInput = {
    relationshipId: 'rel_abc123',
    event: 'merchant.sla_overdue',
    dedupeKey: 'window-2026-08-01',
    slaPolicyVersion: 1,
    occurredAt: '2026-08-01T00:00:00.000Z',
    stage: 'first_sale',
    overdueReason: 'action_past_due',
    outcome: 'retained',
    // ── Every excluded, PII-shaped field, each set to a REALISTIC,
    // searchable value — this is what must NEVER reach the payload.
    businessName: 'Café Don Memo Panadería',
    contactName: 'Juanita Pérez',
    phoneE164: '+5215587654321',
    emailNormalized: 'juanita.perez@example.com',
    whatsappE164: '+5215500000009',
    instagramHandle: '@cafedonmemo',
    objections: 'no confía en pagos en línea',
    fitNote: 'buen ajuste para el cohorte de julio',
    interactionNote: 'llamada del martes, pidió llamar de nuevo el viernes',
    draftText: 'Hola Juanita, seguimos platicando sobre tu tienda...',
    promoterId: 'promo_xyz',
    cohort: 'julio-2026',
    shopId: 'shop_9988',
  }

  test('sanity — EXCLUDED_EVENT_SOURCE_KEYS is non-empty and matches the interface', () => {
    expect(EXCLUDED_EVENT_SOURCE_KEYS.length).toBeGreaterThan(5)
    for (const key of EXCLUDED_EVENT_SOURCE_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(fullyPopulated, key), key).toBe(true)
    }
  })

  test('none of the excluded values appear anywhere in JSON.stringify(payload)', () => {
    const payload = buildPortfolioEventPayload(fullyPopulated)
    const serialized = JSON.stringify(payload)
    const bannedValues = [
      'Café Don Memo Panadería',
      'Juanita Pérez',
      '+5215587654321',
      'juanita.perez@example.com',
      '+5215500000009',
      '@cafedonmemo',
      'no confía en pagos en línea',
      'buen ajuste para el cohorte de julio',
      'llamada del martes',
      'Hola Juanita',
      'promo_xyz',
      'julio-2026',
      'shop_9988',
    ]
    for (const banned of bannedValues) {
      expect(serialized, banned).not.toContain(banned)
    }
  })

  test('none of the excluded KEY NAMES themselves appear in the serialized payload', () => {
    const payload = buildPortfolioEventPayload(fullyPopulated)
    const serialized = JSON.stringify(payload)
    for (const key of EXCLUDED_EVENT_SOURCE_KEYS) {
      expect(serialized, key).not.toContain(key)
    }
  })

  test('the allowed fact (stage/overdueReason/outcome) and slaPolicyVersion DO reach the payload', () => {
    const payload = buildPortfolioEventPayload(fullyPopulated)
    expect(payload.tags.stage).toBe('first_sale')
    expect(payload.tags.overdue_reason).toBe('action_past_due')
    expect(payload.tags.outcome).toBe('retained')
    expect(payload.tags.sla_policy_version).toBe(1)
    expect(payload.userId).toBe('rel_abc123')
    expect(payload.context.subject).toEqual({ type: 'merchant', id: 'rel_abc123' })
  })

  test('the relationship id IS the subject — never treated as PII (activation-ops D1)', () => {
    const payload = buildPortfolioEventPayload(fullyPopulated)
    expect(payload.userId).toBe(fullyPopulated.relationshipId)
  })

  test('an omitted optional fact is OMITTED from tags, never a placeholder', () => {
    const minimal: PortfolioEventSourceInput = {
      relationshipId: 'rel_min',
      event: 'merchant.retention_scheduled',
      dedupeKey: 'retention_30d:rel_min',
    }
    const payload = buildPortfolioEventPayload(minimal)
    expect(payload.tags).not.toHaveProperty('stage')
    expect(payload.tags).not.toHaveProperty('overdue_reason')
    expect(payload.tags).not.toHaveProperty('outcome')
    expect(payload.tags).not.toHaveProperty('sla_policy_version')
  })
})

test.describe('dedupe/idempotency keys are deterministic and per-occurrence', () => {
  test('portfolioEventDedupeKey: same event+discriminator ⇒ same key; different discriminator ⇒ different key', () => {
    const a = portfolioEventDedupeKey('merchant.sla_overdue', '2026-08-01T00:00:00.000Z')
    const b = portfolioEventDedupeKey('merchant.sla_overdue', '2026-08-01T00:00:00.000Z')
    const c = portfolioEventDedupeKey('merchant.sla_overdue', '2026-09-01T00:00:00.000Z')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  test('two DIFFERENT events with the SAME discriminator never collide (the event name is part of the key)', () => {
    const overdue = portfolioEventDedupeKey('merchant.sla_overdue', 'w1')
    const due = portfolioEventDedupeKey('merchant.sla_due', 'w1')
    expect(overdue).not.toBe(due)
  })

  test('portfolioEventIdempotencyKey is deterministic — a REPLAY of the same input never changes the key (walks a double-fire)', () => {
    const first = portfolioEventIdempotencyKey('rel_abc', 'merchant.sla_overdue', 'window-1')
    const second = portfolioEventIdempotencyKey('rel_abc', 'merchant.sla_overdue', 'window-1')
    expect(first).toBe(second)
  })

  test('a DIFFERENT window produces a DIFFERENT idempotency key — recurring events are not collapsed into one', () => {
    const w1 = portfolioEventIdempotencyKey('rel_abc', 'merchant.sla_overdue', 'window-1')
    const w2 = portfolioEventIdempotencyKey('rel_abc', 'merchant.sla_overdue', 'window-2')
    expect(w1).not.toBe(w2)
  })

  test('bounded to 128 chars, truncating the MERCHANT id, never the event name or the dedupe suffix', () => {
    const longId = 'r'.repeat(300)
    const key = portfolioEventIdempotencyKey(longId, 'merchant.sla_overdue', 'window-1')
    expect(key.length).toBeLessThanOrEqual(128)
    expect(key.endsWith(':merchant.sla_overdue:window-1')).toBe(true)
  })
})

test.describe('D8 — the milestone emission path stays BYTE-IDENTICAL after the widened PRIMARY KEY', () => {
  const serverSource = read('lib/merchant-lifecycle-server.ts')
  const sweepSource = read('lib/merchant-lifecycle-sweep.ts')

  test('deliverClaimedEmission defaults dedupeKey to the empty string — a milestone call site that never mentions it behaves exactly as before', () => {
    expect(serverSource).toMatch(/export async function deliverClaimedEmission\(/)
    const sig = serverSource.slice(
      serverSource.indexOf('export async function deliverClaimedEmission('),
      serverSource.indexOf('): Promise<DeliveryOutcome>'),
    )
    expect(sig).toContain("dedupeKey = ''")
  })

  test('the UPDATE predicate is scoped by dedupe_key — without this, one window\'s send would mark every pending occurrence delivered', () => {
    const fnBody = serverSource.slice(
      serverSource.indexOf('export async function deliverClaimedEmission('),
      serverSource.indexOf('export async function listPendingEmissions'),
    )
    expect(fnBody).toContain(".eq('merchant_id', merchantId)")
    expect(fnBody).toContain(".eq('event_type', eventType)")
    expect(fnBody).toContain(".eq('dedupe_key', dedupeKey)")
  })

  test('listPendingEmissions selects and maps dedupe_key onto PendingEmission', () => {
    expect(serverSource).toContain("select('merchant_id, event_type, dedupe_key, payload, attempts')")
    expect(serverSource).toContain('dedupeKey: String(r.dedupe_key ?? \'\')')
  })

  test('the sweep drain threads pending.dedupeKey through to deliverClaimedEmission', () => {
    const start = sweepSource.indexOf('const outcome = await deliverClaimedEmission(')
    const end = sweepSource.indexOf("if (outcome === 'delivered')", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(sweepSource.slice(start, end)).toContain('pending.dedupeKey')
  })

  test('lib/merchant-lifecycle.ts (the CONSUMER accept-list) is completely untouched by this sprint\'s widening', () => {
    const consumerSource = read('lib/merchant-lifecycle.ts')
    // Still exactly 14 (the 13 stages + preview_approved) — proven by
    // re-importing the array itself rather than grepping the source, so a
    // reformat can't fool this assertion either way.
    expect(MERCHANT_LIFECYCLE_EVENTS.length).toBe(14)
    expect(consumerSource).not.toContain('PORTFOLIO_LIFECYCLE_EVENTS')
    expect(consumerSource).not.toMatch(/from ['"]@\/lib\/portfolio/)
  })
})

test.describe('replay-safety — re-claiming a pending row and re-delivering it is free', () => {
  test('emitPortfolioLifecycleEvent claims under the widened PK, never a SELECT-then-INSERT', () => {
    const source = read('lib/portfolio/events-server.ts')
    const insertAt = source.indexOf(".insert({ merchant_id: merchantId, event_type: input.event, dedupe_key: dedupeKey")
    expect(insertAt).toBeGreaterThan(-1)
    // The claim INSERT happens before any SELECT of the same row — the
    // constraint decides "already claimed", never a prior read.
    const selectAt = source.indexOf('.select(\'payload, delivered_at, attempts\')')
    expect(selectAt).toBeGreaterThan(insertAt)
  })

  test('a UNIQUE violation on the claim is treated as success (already claimed), never an error', () => {
    const source = read('lib/portfolio/events-server.ts')
    expect(source).toContain("claimError.code !== UNIQUE_VIOLATION")
  })

  test('an already-delivered row short-circuits to already_emitted — a re-run drains nothing extra', () => {
    const source = read('lib/portfolio/events-server.ts')
    expect(source).toContain("if (row.delivered_at) return 'already_emitted'")
  })
})
