/**
 * lib/portfolio/events.ts
 *
 * Merchant Partner lifecycle · Sprint 3, Story 3.3 — the PURE half of the
 * PII-free SLA/retention event rail (README D8, D9). ZERO-IMPORT: no
 * `server-only`, no `next/*`, no Clerk, no Supabase, so an `api` Playwright
 * spec loads this file with no database.
 *
 * D8 — ITS OWN EMIT-ONLY VOCABULARY, NEVER APPENDED TO
 * `MERCHANT_LIFECYCLE_EVENTS`. That array (`lib/merchant-lifecycle.ts`)
 * doubles as the CONSUMER's accept-list (`isMerchantLifecycleEvent`) and
 * drives the `apply_merchant_lifecycle_event` projection RPC — widening it
 * would have Miyagi accept inbound events its projection has no branch for.
 * `PORTFOLIO_LIFECYCLE_EVENTS` below is a SEPARATE, SEND-ONLY vocabulary;
 * nothing in this repo ever classifies an INBOUND webhook against it, and
 * this file imports nothing from `lib/merchant-lifecycle.ts` (verified by
 * `e2e/portfolio-events.spec.ts`'s source-text guard, so a future edit that
 * adds that import fails loudly rather than silently coupling the two
 * vocabularies).
 *
 * D9 — THE PAYLOAD ALLOWLIST IS POSITIVE. `buildPortfolioEventPayload`
 * CONSTRUCTS the wire payload's `tags` field one key at a time from an
 * explicit allowlist; it never spreads a wider object and deletes what
 * shouldn't be exposed. `PortfolioEventSourceInput` is typed to ALSO carry
 * every PII-shaped field a caller might have on hand
 * (`businessName`/`phoneE164`/`emailNormalized`/`whatsappE164`/
 * `instagramHandle`/`objections`/`fitNote`/`interactionNote`/`draftText`/
 * `promoterId`/`cohort`/`shopId`) — present ONLY so
 * `e2e/portfolio-events.spec.ts` can feed a fully-populated, PII-carrying
 * fixture through `buildPortfolioEventPayload` and prove none of those
 * values reach `JSON.stringify(payload)`. Same discipline as
 * `lib/portfolio/draft-facts.ts#DraftFactsSourceInput` — no resolver below
 * ever reads one of the excluded keys.
 *
 * The relationship id IS the opaque merchant subject (activation-ops
 * D1 — already established for the 14 milestone events); it is never a
 * contact value, so it is not excluded.
 *
 * The wire shape (`PortfolioTrackPayload`) is deliberately STRUCTURALLY
 * IDENTICAL to `lib/merchant-lifecycle.ts#LifecycleTrackPayload` (same
 * field names, same nesting) so the impure `events-server.ts` sibling can
 * hand it to the SAME `deliverClaimedEmission` (`lib/merchant-lifecycle-server.ts`)
 * every milestone already goes through — "one sender, one outbox, one
 * drain" (README D8) — via a narrow, well-commented cast rather than a
 * parallel sender. This file does not import that one, and that one does
 * not import this one; the two vocabularies stay independent at the TYPE
 * level too, not merely the value level.
 */
import { createHash } from 'node:crypto'

export const PORTFOLIO_LIFECYCLE_EVENTS = [
  'merchant.steward_assigned',
  'merchant.sla_due',
  'merchant.sla_overdue',
  'merchant.sla_completed',
  'merchant.retention_scheduled',
  'merchant.retention_outcome_recorded',
] as const

export type PortfolioLifecycleEvent = (typeof PORTFOLIO_LIFECYCLE_EVENTS)[number]

const PORTFOLIO_EVENT_SET: ReadonlySet<string> = new Set(PORTFOLIO_LIFECYCLE_EVENTS)

export function isPortfolioLifecycleEvent(value: unknown): value is PortfolioLifecycleEvent {
  return typeof value === 'string' && PORTFOLIO_EVENT_SET.has(value)
}

/** Bump on any change to the payload shape — echoed in every event's `tags`
 *  so a consumer can tell which shape it received. Independent of
 *  `SCORECARD_SCHEMA_VERSION`/`SLA_POLICY_VERSION` — this versions the
 *  EVENT payload, not a metric or a policy document. */
export const PORTFOLIO_EVENT_SCHEMA_VERSION = 1

/** Mirrors `lib/merchant-lifecycle.ts#MERCHANT_LIFECYCLE_FEATURE_ID` — a
 *  distinct feature id so a Golden Beans operator can tell portfolio
 *  stewardship events apart from activation milestones in the same
 *  project, even though both ride the same outbox on this side. */
export const PORTFOLIO_EVENT_FEATURE_ID = 'merchant-partner-portfolio'

export const PORTFOLIO_EVENT_CONTEXT_VERSION = 1 as const

/**
 * `<event>:<discriminator>` — the SAME idea as
 * `lib/portfolio/reminders.ts#reminderWindowKey`, computed independently
 * here (this file must not import that Sprint-2 module — zero-import).
 * The SAME discriminator always produces the SAME key, which is the whole
 * idempotency argument (README D8): the caller claims
 * `(merchantId, event, dedupeKey)` under the widened PRIMARY KEY, and a
 * repeat claim for the SAME window/occurrence hits the constraint and is
 * skipped, never a SELECT-then-INSERT.
 */
export function portfolioEventDedupeKey(event: PortfolioLifecycleEvent, discriminator: string): string {
  return `${event}:${discriminator}`
}

/**
 * Mirrors `lib/merchant-lifecycle.ts#lifecycleIdempotencyKey`'s exact
 * truncation discipline (bounded to golden-beans' 128-char limit by
 * truncating the MERCHANT id, never the event name or the dedupe suffix —
 * a truncated event name or suffix would collide two different
 * occurrences into one key, which is the one thing idempotency must never
 * do). Computed independently rather than imported, for the same
 * zero-import/no-coupling reason as `portfolioEventDedupeKey` above.
 */
/**
 * A short, stable, NON-REVERSIBLE key for a value that identifies a PERSON.
 *
 * Added for fresh-reviewer finding 4 (PR 311). The reassign route composed its
 * dedupe key from the incoming steward's raw Clerk id, and `portfolioEventIdempotencyKey`
 * embeds the dedupe key VERBATIM into `context.idempotencyKey` — so `user_2abc…`
 * was transmitted cross-repo to Golden Beans. D9's letter permitted it (the
 * idempotency key is an allowlisted field), but the construction was internally
 * inconsistent: `EXCLUDED_EVENT_SOURCE_KEYS` forbids `promoterId`, `cohort` and
 * `shopId` — opaque INTERNAL ids — while a Clerk id, which names a human and is
 * the join key to that human's account, entered through a side channel the D9
 * spec cannot see (it feeds the builder a synthetic dedupe key, so the leak lives
 * in the caller).
 *
 * SHA-256, truncated to 16 hex chars. Requirements this has to meet, in order:
 *   · STABLE — the same steward must produce the same key forever, or the
 *     idempotency guarantee the key exists for evaporates.
 *   · NON-REVERSIBLE for the recipient — Golden Beans cannot recover the Clerk id.
 *   · COLLISION-IRRELEVANT — 64 bits over a set of stewards numbering in the
 *     dozens. A collision would merely dedupe two distinct assignments into one
 *     event, which is a lost measurement, not a wrong write.
 *
 * NOT a security control: an attacker who already knows a Clerk id can confirm it
 * by hashing. It removes the id from the wire; it does not make the id secret.
 * `node:crypto` is a Node builtin, so this file still loads in the Playwright
 * `api` project (the constraint is no `server-only`/`next`/Clerk/Supabase).
 */
export function opaqueActorKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function portfolioEventIdempotencyKey(
  relationshipId: string,
  event: PortfolioLifecycleEvent,
  dedupeKey: string,
): string {
  const suffix = `:${dedupeKey}`
  const budget = 128 - event.length - suffix.length - 1
  return `${relationshipId.slice(0, Math.max(1, budget))}:${event}${suffix}`
}

/**
 * The raw input a caller might have on hand when building a portfolio
 * event — see the file header. Only the ALLOWED half is ever read by
 * `buildPortfolioEventPayload`.
 */
export interface PortfolioEventSourceInput {
  // ── Allowed ──────────────────────────────────────────────────────────
  /** The opaque merchant subject id (activation-ops D1) — a relationship
   *  id, never a contact value. */
  relationshipId: string
  event: PortfolioLifecycleEvent
  /** The idempotency discriminator — REQUIRED and must be non-empty for a
   *  recurring portfolio event (D8: "recurring portfolio events pass a
   *  real key"). Build it with `portfolioEventDedupeKey`. */
  dedupeKey: string
  slaPolicyVersion?: number | null
  occurredAt?: string
  /** The SLA/retention FACT this event carries — a stage slug, an SLA
   *  overdue reason, or a retention outcome. Every one of these is already
   *  a closed, non-PII vocabulary value (`lib/merchant-stage.ts`,
   *  `lib/portfolio/sla.ts`, `lib/scorecard/dictionary.ts`), never free text. */
  stage?: string
  overdueReason?: string
  outcome?: string

  // ── EXCLUDED — never read by buildPortfolioEventPayload (D9) ───────────
  businessName?: string
  contactName?: string | null
  phoneE164?: string | null
  emailNormalized?: string | null
  whatsappE164?: string | null
  instagramHandle?: string | null
  objections?: string | null
  fitNote?: string | null
  interactionNote?: string | null
  draftText?: string | null
  promoterId?: string | null
  cohort?: string | null
  shopId?: string | null
}

/** The keys `PortfolioEventSourceInput` types but that
 *  `buildPortfolioEventPayload` never reads — used by
 *  `e2e/portfolio-events.spec.ts` to re-derive the excluded population from
 *  this file's own interface rather than a hand-written list living only
 *  in the spec (mirrors `lib/portfolio/draft-facts.ts#EXCLUDED_SOURCE_KEYS`). */
export const EXCLUDED_EVENT_SOURCE_KEYS = [
  'businessName',
  'contactName',
  'phoneE164',
  'emailNormalized',
  'whatsappE164',
  'instagramHandle',
  'objections',
  'fitNote',
  'interactionNote',
  'draftText',
  'promoterId',
  'cohort',
  'shopId',
] as const

/** Structurally identical to `lib/merchant-lifecycle.ts#LifecycleTrackPayload`
 *  — see the file header for why this is a deliberate, independent type
 *  rather than an import. */
export interface PortfolioTrackPayload {
  userId: string
  event: PortfolioLifecycleEvent
  featureId: string
  tags: Record<string, string | number>
  context: {
    version: 1
    subject: { type: 'merchant'; id: string }
    occurredAt: string
    idempotencyKey: string
    correlationId?: string
  }
}

/**
 * CONSTRUCT the wire payload from the allowlist — never spread `input` and
 * delete what shouldn't be exposed (D9, file header). `tags` carries only:
 * the schema version, the SLA policy version (when known), and the SLA/
 * retention fact itself — never a contact value, note, draft text or
 * attribution field.
 */
export function buildPortfolioEventPayload(input: PortfolioEventSourceInput): PortfolioTrackPayload {
  const merchantId = String(input.relationshipId ?? '')
  const tags: Record<string, string | number> = { schema_version: PORTFOLIO_EVENT_SCHEMA_VERSION }
  if (input.slaPolicyVersion !== undefined && input.slaPolicyVersion !== null) {
    tags.sla_policy_version = input.slaPolicyVersion
  }
  if (input.stage !== undefined) tags.stage = input.stage
  if (input.overdueReason !== undefined) tags.overdue_reason = input.overdueReason
  if (input.outcome !== undefined) tags.outcome = input.outcome

  return {
    userId: merchantId,
    event: input.event,
    featureId: PORTFOLIO_EVENT_FEATURE_ID,
    tags,
    context: {
      version: PORTFOLIO_EVENT_CONTEXT_VERSION,
      subject: { type: 'merchant', id: merchantId },
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      idempotencyKey: portfolioEventIdempotencyKey(merchantId, input.event, input.dedupeKey),
    },
  }
}
