/**
 * POST /api/webhooks/golden-beans
 *
 * Golden Beans event-destination-router · Story 3.1 — the Miyagi merchant-lifecycle
 * projection endpoint. This is the receiver configured as a signed-webhook destination
 * on the Golden Beans `miyagisanchez` project (owner-only UI at
 * `/app/destinations/miyagisanchez`; the destination is born DISABLED and its signing
 * secret is shown exactly once).
 *
 * Contract: golden-beans `Roadmap/01-growth-engine/event-destination-router/
 * miyagi-lifecycle-contract.md`. Read it before changing a status code here — Golden
 * Beans CLASSIFIES our responses, and each one means something to its dispatcher.
 *
 * ┌ THE ONE THING TO GET RIGHT ────────────────────────────────────────────────┐
 * │ The HMAC covers the exact bytes Golden Beans sent. We read the RAW body with │
 * │ `await request.text()` BEFORE any parsing, verify against those bytes, and   │
 * │ only then JSON.parse them. Calling `request.json()` first and verifying a    │
 * │ re-serialized object fails every time — key order, whitespace and number     │
 * │ formatting all shift — and it fails looking exactly like a Golden Beans bug. │
 * │ A request body can also only be consumed ONCE, so the order is not optional. │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Status codes, and why:
 *   401 — signature could not be verified, INCLUDING when our secret is unset. Golden
 *         Beans treats 401 as a permanent 4xx and dead-letters immediately, which is
 *         correct: a signature that fails will keep failing on every retry.
 *   400 — verified, but the envelope is structurally broken or a lifecycle event with
 *         no routable merchant subject. Also permanent, also dead-lettered, and that
 *         is the point: it surfaces a producer defect in delivery history instead of
 *         burning six retries on a body that will never parse.
 *   202 — verified and well-formed, but not ours. The destination receives EVERY event
 *         of the project, so unrelated types must be accepted and dropped.
 *   200 — projected, or deduplicated (a replay is a success, not a failure).
 *   503 — a TRANSIENT Miyagi/Supabase outage. Retryable: Golden Beans backs off and
 *         returns. Never 2xx here to "avoid retries" — that silently drops the event.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/webhook-signature'
import { classifyEnvelope } from '@/lib/merchant-lifecycle'
import { applyLifecycleEvent } from '@/lib/merchant-lifecycle-server'

// node:crypto (timingSafeEqual) — not available on the edge runtime.
export const runtime = 'nodejs'
// Signature verification is per-request by construction; never let a response cache.
export const dynamic = 'force-dynamic'

const SIGNATURE_HEADER = 'x-gb-signature'
const DELIVERY_ID_HEADER = 'x-gb-delivery-id'

/** Golden Beans times out at 10s. We answer inside that window no matter what the DB
 *  is doing — a timed-out delivery is recorded as a FAILURE and retried, which is the
 *  same outcome as our 503 but costs the dispatcher a held connection first. */
const PROJECTION_BUDGET_MS = 8_000

/** A delivery is one small envelope. A body far larger than that is not a Golden Beans
 *  delivery, and hashing an unbounded payload before rejecting it is free work for an
 *  attacker who does not even need a valid secret. */
const MAX_BODY_BYTES = 256 * 1024

export async function POST(request: NextRequest) {
  // 0. Reject an oversized body BEFORE reading it. `request.text()` buffers the whole
  //    thing, so a check after it does not bound anything (cross-review round 4).
  //    Content-Length covers the ordinary case at zero cost; a chunked request without
  //    one still gets the post-read check below, which is a real gap this cannot close
  //    from a route handler — the platform's own body limit is what bounds that.
  const declaredLength = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  // 1. RAW BODY FIRST. Nothing may parse, normalize or re-serialize before this.
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 })
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  // 2. FAIL CLOSED on a missing secret. An unset env var must never mean "allow" —
  //    that turns the projection into an unauthenticated public writer, and it is the
  //    exact state a fresh deploy or a botched secret rotation lands in.
  const secret = process.env.GOLDEN_BEANS_WEBHOOK_SECRET
  if (!secret) {
    console.error('[gb-webhook] GOLDEN_BEANS_WEBHOOK_SECRET is not set — rejecting delivery')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 3. Verify over the exact bytes. The verifier is copied verbatim from the producer
  //    (lib/webhook-signature.ts) and enforces the 300s tolerance window — the only
  //    thing bounding replay of a byte-perfect capture.
  const header = request.headers.get(SIGNATURE_HEADER) ?? ''
  const verified = verifyWebhookSignature(secret, rawBody, header)
  if (!verified.ok) {
    // The reason is logged, never returned: telling an unauthenticated caller whether
    // its timestamp or its signature was wrong is a free oracle.
    console.warn(`[gb-webhook] rejected delivery: ${verified.reason}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 4. Only now is it safe to parse.
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const decision = classifyEnvelope(parsed)

  if (decision.kind === 'invalid') {
    console.warn(`[gb-webhook] invalid envelope: ${decision.reason}`)
    return NextResponse.json({ error: 'Invalid envelope', reason: decision.reason }, { status: 400 })
  }

  // A "Send test" from the destinations UI — the FIRST thing this endpoint ever sees.
  // Verified and acknowledged so the owner gets a green result, and deliberately never
  // projected: a synthetic envelope must not create merchant state.
  if (decision.kind === 'test') {
    return NextResponse.json({ ok: true, test: true, eventId: decision.eventId }, { status: 200 })
  }

  if (decision.kind === 'ignored') {
    return NextResponse.json({ ok: true, ignored: decision.reason }, { status: 202 })
  }

  const deliveryId = request.headers.get(DELIVERY_ID_HEADER)

  // Projected synchronously: it is a single round trip, and it is the only way to
  // honour "5xx on a transient outage". Answering 202 and projecting in the background
  // would make every DB failure invisible to the dispatcher — it would see success and
  // never retry, which is precisely the silent drop the contract forbids.
  const result = await withBudget(
    applyLifecycleEvent({
      eventId: decision.eventId,
      type: decision.type,
      merchantId: decision.merchantId,
      occurredAt: decision.occurredAt,
      deliveryId,
      payload: parsed,
    }),
  )

  if (result.status === 'error') {
    console.error(`[gb-webhook] projection failed for ${decision.eventId}: ${result.message}`)
    // 503, not 500: explicitly transient, explicitly retryable.
    return NextResponse.json({ error: 'Projection unavailable' }, { status: 503 })
  }

  return NextResponse.json(
    { ok: true, eventId: decision.eventId, applied: result.status === 'applied' },
    { status: 200 },
  )
}

/**
 * Resolve within the budget or report a transient failure. A slow query still commits
 * on the database side; reporting it as retryable is correct because the retry is
 * deduped by event id and therefore harmless.
 */
async function withBudget<T extends { status: string }>(
  work: Promise<T>,
): Promise<T | { status: 'error'; message: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ status: 'error'; message: string }>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: 'error', message: `projection exceeded ${PROJECTION_BUDGET_MS}ms` }),
      PROJECTION_BUDGET_MS,
    )
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
