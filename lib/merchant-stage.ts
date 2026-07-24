/**
 * lib/merchant-stage.ts
 *
 * Founding merchant activation operations · Sprint 2 (Story 2.1) — the pure
 * 13-stage lifecycle resolver (README D3: "stage is DERIVED, corrections are
 * the only writes"). Zero-import, same convention as `lib/merchant-identity.ts`
 * and `lib/merchant-lifecycle.ts`, so an `api` spec can import this file
 * directly and walk every branch with no database, no Clerk, no Next.
 *
 * `resolveStage` takes a FLAT bag of already-fetched facts (consent evidence,
 * commerce facts, CRM facts — fetching them is Sprint 3's commerce-fact
 * adapter, not this module) and returns the FURTHEST stage whose chain of
 * predicates holds, walked in canonical order. It is:
 *
 *   - MONOTONIC BY CONSTRUCTION: stage N is only reachable by first passing
 *     every predicate for stages 2..N-1 IN ORDER (`scouted` is the free
 *     baseline every relationship starts at). There is no branch that can
 *     skip ahead — the walk stops at the first failing predicate.
 *
 *   - FAIL-CLOSED: `StageFacts` fields are plain optional booleans; every
 *     predicate below checks `=== true`, so `undefined`, `false`, or any
 *     non-boolean garbage a caller might pass all decline identically —
 *     "we don't know" never grants a stage. This is the trap
 *     `merchant-lifecycle-projection` paid nine defects to learn
 *     (Roadmap/LEARNINGS.md): every one of these milestones is write-once and
 *     UNWITHDRAWABLE, so the CALLER must derive each fact as "did this EVER
 *     become true" (and keep passing `true` forever after), never as "is this
 *     true RIGHT NOW". A merchant who reaches `first_sale` and later refunds
 *     must still resolve to (at least) `first_sale` — but that invariant is
 *     the CALLER's obligation (Sprint 3's commerce-fact adapter); this module
 *     has no history of its own to protect it. It only ever refuses to grant
 *     a stage its OWN input, this call, didn't earn.
 *
 * PERMISSION-GATED STAGES: `permission_granted` and `preview_delivered` each
 * take their evidence from their OWN dedicated boolean —
 * `permissionGrantedEvidence` / `previewDeliveredEvidence` — which the caller
 * MUST derive from `readApprovalState` (`lib/preview-consent.ts`), never from
 * a free-text note (`fit_note` / `objections`). `StageFacts` has no field a
 * note could populate for either predicate — there is no code path from a
 * note to a stage. `e2e/merchant-stage.spec.ts` asserts this directly, per
 * the build contract's explicit call to test it.
 *
 * BUILD-CONTRACT DEVIATION (flagged for the architect, not silently
 * resolved): sprint-2.md's prose names stage 3 `permission_received`. The
 * ALREADY-MERGED Sprint 1 migration's CHECK constraint on
 * `merchant_relationships.stage` — plus README D2 and the live
 * `MERCHANT_LIFECYCLE_EVENTS` vocabulary in `lib/merchant-lifecycle.ts` — all
 * use `permission_granted`. This module follows the SCHEMA, not the prose: a
 * resolver whose stage slug the DB CHECK would reject can never actually
 * write the transition it derives. If `permission_received` was genuinely
 * intended, both CHECK constraints need a coordinated follow-up migration,
 * not a silent one-sided rename here.
 *
 * Also flagged: sprint-2.md's build contract literally says the two
 * permission-gated stages share ONE `consentEvidence` fact. This module gives
 * each of the 12 non-`scouted` stages its OWN predicate field instead
 * (`permissionGrantedEvidence` / `previewDeliveredEvidence` rather than one
 * reused boolean) — same guarantee (neither is reachable without dedicated,
 * non-note evidence; the walk-in-order chain still means `preview_delivered`
 * is UNREACHABLE unless `permission_granted` already passed first), but
 * testable and semantically distinct rather than ambiguous about which
 * real-world fact backs which stage.
 */

/** The 13 canonical stages, in order. Ordinals below are FROZEN 1–13
 *  (sprint-2.md: "persisted in transition rows... appending, never
 *  renumbering") — inserting a 14th stage later means appending to the END
 *  of this array, never reordering it. */
export const STAGES = [
  'scouted',
  'qualified',
  'permission_granted',
  'preview_in_preparation',
  'preview_delivered',
  'activation_scheduled',
  'claimed',
  'payments_ready',
  'three_products_live',
  'shared_externally',
  'first_inquiry',
  'first_sale',
  'retained_30d',
] as const

export type Stage = (typeof STAGES)[number]

/** Frozen ordinals 1–13, derived from array position so they can never drift
 *  from `STAGES` itself. */
export const STAGE_ORDINAL: Readonly<Record<Stage, number>> = STAGES.reduce(
  (acc, stage, i) => {
    acc[stage] = i + 1
    return acc
  },
  {} as Record<Stage, number>,
)

const STAGE_SET: ReadonlySet<string> = new Set(STAGES)

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && STAGE_SET.has(value)
}

/**
 * Already-fetched facts, one boolean per non-baseline stage (12 — `scouted`
 * needs no fact, every relationship starts there per the S1 migration's
 * column default). `true` means "this stage's condition has EVER held"
 * (write-once, CALLER-maintained per the file header's fail-closed note);
 * anything else (`false`, `undefined`, omitted) declines.
 */
export interface StageFacts {
  qualified?: boolean
  /** MUST be derived from `readApprovalState(...)` (current, non-stale
   *  approval) — never from a note. See file header. */
  permissionGrantedEvidence?: boolean
  previewInPreparation?: boolean
  /** MUST be derived from the preview anchor's own delivered/shown state via
   *  the same consent-evidence pipeline as `permissionGrantedEvidence` —
   *  never from a note. See file header. */
  previewDeliveredEvidence?: boolean
  activationScheduled?: boolean
  claimed?: boolean
  paymentsReady?: boolean
  threeProductsLive?: boolean
  sharedExternally?: boolean
  firstInquiry?: boolean
  firstSale?: boolean
  retained30d?: boolean
}

type GatedStage = Exclude<Stage, 'scouted'>

const PREDICATES: Readonly<Record<GatedStage, (facts: StageFacts) => boolean>> = {
  qualified: (f) => f.qualified === true,
  permission_granted: (f) => f.permissionGrantedEvidence === true,
  preview_in_preparation: (f) => f.previewInPreparation === true,
  preview_delivered: (f) => f.previewDeliveredEvidence === true,
  activation_scheduled: (f) => f.activationScheduled === true,
  claimed: (f) => f.claimed === true,
  payments_ready: (f) => f.paymentsReady === true,
  three_products_live: (f) => f.threeProductsLive === true,
  shared_externally: (f) => f.sharedExternally === true,
  first_inquiry: (f) => f.firstInquiry === true,
  first_sale: (f) => f.firstSale === true,
  retained_30d: (f) => f.retained30d === true,
}

export interface ResolvedStage {
  stage: Stage
  /** Every stage reached, in order, `scouted` first — always a prefix of
   *  `STAGES` (the monotonic chain). */
  reached: Stage[]
}

/**
 * Walk `STAGES` in order starting after `scouted`, stopping at the first
 * predicate that doesn't hold (fail-closed) or that `facts` doesn't say
 * `true` for. Never throws on a null/undefined-ish `facts` — treated as "no
 * facts at all", which resolves to `scouted`.
 */
export function resolveStage(facts: StageFacts): ResolvedStage {
  const safeFacts: StageFacts = facts ?? {}
  const reached: Stage[] = ['scouted']
  for (let i = 1; i < STAGES.length; i++) {
    const stage = STAGES[i] as GatedStage
    if (!PREDICATES[stage](safeFacts)) break
    reached.push(stage)
  }
  return { stage: reached[reached.length - 1], reached }
}

// ── Transition dedupe keys (migration: `UNIQUE (relationship_id, dedupe_key)`
// makes replay a no-op BY CONSTRAINT, never by a SELECT-then-INSERT — see
// supabase/migrations/20260723110000_activation_crm_s2.sql header) ─────────

/** The natural dedupe key for a DERIVED advance onto `stage` — reusing the
 *  same key for the same relationship + stage twice hits the UNIQUE
 *  constraint and inserts nothing the second time. Sprint 3's commerce-fact
 *  adapter is the actual writer; this is the key it must use. */
export function advanceDedupeKey(stage: Stage): string {
  return stage
}

/** The dedupe key for an audited correction. Always carries a fresh id, so
 *  the UNIQUE constraint never blocks two DIFFERENT corrections on the same
 *  relationship — a correction's replay-safety is the caller's job (don't
 *  submit the same correction twice), not this key's. */
export function correctionDedupeKey(correctionId: string): string {
  return `correction:${correctionId}`
}

export function isCorrectionDedupeKey(key: string): boolean {
  return key.startsWith('correction:')
}
