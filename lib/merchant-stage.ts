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
 * adapter, not this module) and returns EVERY stage whose predicate
 * independently holds, plus the furthest (highest-ordinal) among them as
 * `stage`. It is:
 *
 *   - INDEPENDENT PER STAGE (E1a — architect review of the S3 build): each
 *     predicate is evaluated on its own; a gap does NOT stop the walk. An
 *     earlier version walked a contiguous prefix and `break`-ed on the first
 *     gap, which let a soft CRM fact hold a hard commerce fact HOSTAGE
 *     (`first_sale` unreachable behind an unsatisfiable `shared_externally`)
 *     and emitted nothing for a shop claimed-and-sold outside the funnel. See
 *     the fuller note on `resolveStage` itself.
 *
 *   - MONOTONIC AT THE PERSISTENCE LAYER, not by contiguity: the CALLER merges
 *     `factsAtOrAbove(the persisted stage)` before calling, so a
 *     genuinely-reached milestone is pinned `true` and never un-reaches on a
 *     flickering live fact. `scouted` is the free baseline every relationship
 *     starts at. This module has no history of its own; it only refuses to
 *     grant a stage its OWN input, this call, didn't earn.
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
 * reused boolean) — same guarantee (neither MILESTONE enters `reached` without
 * its own dedicated, non-note evidence, so neither can ever be emitted from a
 * note), but testable and semantically distinct rather than ambiguous about
 * which real-world fact backs which stage. Note under E1a the two are
 * evaluated independently: an absent `permissionGrantedEvidence` keeps
 * `permission_granted` out of `reached` on its own, whether or not
 * `preview_delivered`'s evidence happens to hold — the per-stage gate is what
 * guarantees the security property, not a walk-order chain.
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
  /** Every stage whose predicate independently holds, in `STAGES` order,
   *  `scouted` first. NOT necessarily a contiguous prefix — a merchant can
   *  reach `first_sale` (a Medusa order) without ever reaching
   *  `shared_externally` (a `share_done` flag). See `resolveStage`. */
  reached: Stage[]
}

/**
 * Evaluate every gated stage's predicate INDEPENDENTLY and return each one
 * that holds; `stage` is the furthest (highest-ordinal) among them.
 *
 * This deliberately does NOT stop at the first failing predicate. An earlier
 * version walked a contiguous prefix and `break`-ed on the first gap — which
 * let a soft CRM fact hold a hard commerce fact HOSTAGE: with
 * `shared_externally` (10) unsatisfiable, `first_sale` (12) and
 * `retained_30d` (13) became permanently unreachable no matter what Medusa
 * said, silently defeating epic acceptance 5. It also emitted NOTHING for a
 * shop claimed-and-sold outside the promoter funnel (the common shape for the
 * S1 backfill's 29 shops), which broke on the very first gated predicate.
 *
 * Each milestone is emitted independently and is write-once, so "every
 * milestone genuinely satisfied" is the truthful set, not "the unbroken
 * prefix". Fail-closed is UNCHANGED: an unknown/absent fact still declines
 * its OWN stage (`=== true` only) — it simply no longer vetoes later ones.
 * Monotonicity is preserved by the CALLER, which merges `factsAtOrAbove(the
 * persisted stage)` so a genuinely-reached milestone never un-reaches on a
 * flickering live fact.
 *
 * Because the evaluator only ever writes/emits transitions whose ordinal is
 * ABOVE the persisted stage, mirroring `stage = max(reached)` can never
 * retroactively emit a SKIPPED lower milestone: once the mirror jumps past a
 * gap, the skipped stage sits below `fromOrdinal` forever and is never a
 * candidate. The projection therefore never receives a false
 * `shared_externally` it can't withdraw.
 *
 * Never throws on a null/undefined-ish `facts` — treated as "no facts at
 * all", which resolves to `scouted`.
 */
export function resolveStage(facts: StageFacts): ResolvedStage {
  const safeFacts: StageFacts = facts ?? {}
  const reached: Stage[] = ['scouted']
  for (let i = 1; i < STAGES.length; i++) {
    const stage = STAGES[i] as GatedStage
    if (PREDICATES[stage](safeFacts)) reached.push(stage)
  }
  // `reached` is built in `STAGES` order, so the last element is the
  // highest-ordinal milestone reached.
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

// ── Permanence (Sprint 3, Story 3.1) ───────────────────────────────────────

/** The GatedStage → StageFacts key it is satisfied by, in `STAGES` order. Kept
 *  next to `PREDICATES` (same pairing, opposite direction) so the two can
 *  never drift — this file is the only place either is allowed to change. */
const FACT_KEY_FOR_STAGE: Readonly<Record<GatedStage, keyof StageFacts>> = {
  qualified: 'qualified',
  permission_granted: 'permissionGrantedEvidence',
  preview_in_preparation: 'previewInPreparation',
  preview_delivered: 'previewDeliveredEvidence',
  activation_scheduled: 'activationScheduled',
  claimed: 'claimed',
  payments_ready: 'paymentsReady',
  three_products_live: 'threeProductsLive',
  shared_externally: 'sharedExternally',
  first_inquiry: 'firstInquiry',
  first_sale: 'firstSale',
  retained_30d: 'retained30d',
}

/**
 * A relationship's CURRENT `stage` column is itself a write-once-earliest fact:
 * once `merchant_relationships.stage` (or a `merchant_relationship_transitions`
 * row) says a relationship reached stage N, that milestone is permanent —
 * exactly the discipline `lib/merchant-stage.ts`'s file header already
 * requires of every `StageFacts` field ("did this EVER become true", never
 * "is this true RIGHT NOW").
 *
 * The commerce-fact adapter's Medusa/CRM reads are necessarily a snapshot of
 * RIGHT NOW (a refund, an outage, a since-unpublished product can all make a
 * later read of the same fact come back false). Feeding a fresh read straight
 * into `resolveStage` would let the relationship's resolved stage REGRESS —
 * the one thing D3 forbids ("manual CRM edits cannot overwrite commerce
 * truth", and by the same logic neither can a transient read). The caller
 * (Sprint 3's relationship evaluator) is expected to OR this against the
 * fresh facts before calling `resolveStage`, so the walk can only ever hold
 * steady or advance.
 */
export function factsAtOrAbove(stage: Stage): StageFacts {
  const facts: StageFacts = {}
  const idx = STAGES.indexOf(stage)
  for (let i = 1; i <= idx; i++) {
    const s = STAGES[i] as GatedStage
    facts[FACT_KEY_FOR_STAGE[s]] = true
  }
  return facts
}

/** The full list of `StageFacts` keys, derived from `FACT_KEY_FOR_STAGE` so it
 *  can never drift from the predicate table above. */
const ALL_FACT_KEYS: ReadonlyArray<keyof StageFacts> = Object.values(FACT_KEY_FOR_STAGE)

/**
 * OR two fact bags together, field by field — `true` wins. This is the merge
 * `factsAtOrAbove`'s doc comment calls for: permanent memory (what a
 * relationship has EVER reached) OR-ed with a fresh read (what is true RIGHT
 * NOW), so the combined result can only hold steady or advance, never regress.
 * A naive object spread (`{...a, ...b}`) would let an explicit `false` or
 * `undefined` in `b` overwrite a `true` in `a` — this walks every known key
 * instead, so that can't happen regardless of which bag is spread over which.
 */
export function mergeStageFacts(a: StageFacts, b: StageFacts): StageFacts {
  const merged: StageFacts = {}
  for (const key of ALL_FACT_KEYS) {
    if (a[key] === true || b[key] === true) merged[key] = true
  }
  return merged
}

// ── Emission gate (Sprint 3, Story 3.2) ────────────────────────────────────
// Kept HERE, zero-import, rather than in `lib/merchant-relationship-lifecycle.ts`
// (which imports `server-only` and Supabase and so cannot be imported by a
// plain-Node Playwright spec at all — the `server-only` package THROWS
// unconditionally outside a webpack `react-server` build). The DB-touching
// half (`hasLiveConsentEvidence`) stays in that impure module; this file only
// holds the DECISION, so a spec can walk every branch with no database.

export type TransitionActorType = 'promoter' | 'admin' | 'system' | 'commerce_fact'

/**
 * The two stages whose "evidence" fact (`StageFacts` header above) is
 * required to come from `readApprovalState`, never a note. An admin CAN
 * write either via `correct-stage` with no consent check at all (S2) —
 * harmless there (nothing reads `stage` as consent proof), dangerous once a
 * stage transition also broadcasts an UNWITHDRAWABLE Golden Beans milestone
 * (README D2 — write-once-earliest `LEAST()`). Exported as data so this set
 * and `shouldEmitStageTransition` below can never disagree about which
 * stages it covers.
 */
export const CONSENT_GATED_STAGES: ReadonlySet<Stage> = new Set(['permission_granted', 'preview_delivered'])

/**
 * Pure gate decision: given a transition's actor/stage and a single
 * ALREADY-RESOLVED boolean for "does live consent evidence back this right
 * now", should it emit to Golden Beans? The transition row itself is written
 * regardless (the audit trail is never suppressed) — this only decides the
 * broadcast.
 *
 * Every actor/stage combination except "admin onto a gated stage" emits
 * unconditionally: a `commerce_fact` (derived-advance) transition is already
 * backed by the fact that produced it, and every stage outside the gated two
 * has no note-shaped ambiguity to guard against.
 */
export function shouldEmitStageTransition(
  actorType: TransitionActorType,
  toStage: Stage,
  liveConsentEvidenced: boolean,
): boolean {
  if (actorType === 'admin' && CONSENT_GATED_STAGES.has(toStage)) return liveConsentEvidenced
  return true
}
