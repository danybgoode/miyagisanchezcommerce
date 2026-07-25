/**
 * lib/portfolio/draft-facts.ts
 *
 * Merchant Partner lifecycle · Sprint 2, Story 2.1 — the POSITIVE fact
 * allowlist for a follow-up draft (README D4: a versioned deterministic
 * template composer, never a model call). This file decides WHAT a draft may
 * be built from; `lib/portfolio/draft-compose.ts` decides HOW that fact set
 * becomes text.
 *
 * ZERO-IMPORT (build contract): no `server-only`, no `next/*`, no Clerk, no
 * Supabase, so an `api` Playwright spec loads this file — and feeds it a
 * fully-populated fixture — with no database. The impure half that actually
 * READS a relationship, its open tasks, its linked shop and the acting
 * partner's name lives in the `draft-server.ts` sibling.
 *
 * A POSITIVE-LIST BUILDER, NEVER A DELETE-FROM-A-WIDER-OBJECT (file-wide
 * discipline this epic repeats — `lib/portfolio/resolver.ts#buildPortfolioRow`
 * is the same shape). `DRAFT_FACT_ALLOWLIST` below is the exhaustive list of
 * ids `buildDraftFacts` will EVER emit; every entry names its own resolver, so
 * a fact this file does not name can never appear in a composed draft — there
 * is no `...spread` anywhere in this module that could let one through.
 *
 * `DraftFactsSourceInput` intentionally ALSO types every EXCLUDED field
 * (`phoneE164`, `emailNormalized`, `whatsappE164`, `instagramHandle`,
 * `objections`, `fitNote`, `promoterId`, `cohort`, `taskOutcomeNote`,
 * `secretOrTokenValue`) — present ONLY so a spec can feed a fully-populated,
 * PII-carrying relationship-shaped fixture through `buildDraftFacts` and prove
 * none of those values reach the returned fact set. No resolver below ever
 * reads one of those keys; if a future resolver did, the file header's own
 * claim (and `e2e/portfolio-draft.spec.ts`'s population guard, which re-derives
 * the excluded-key set from this very interface) would catch it.
 */

/** The exhaustive, ORDERED set of fact ids a draft may ever be built from.
 *  Order matches the build contract's own listing — `DRAFT_FACT_ALLOWLIST`
 *  below emits facts in this order, so `composeDraft`'s `factIds` output is
 *  deterministic. */
export const DRAFT_FACT_IDS = [
  'stage',
  'stage_label',
  'age_in_stage_days',
  'next_action_title',
  'next_action_due_at',
  'preferred_channel',
  'public_shop_url',
  'preview_url',
  'partner_display_name',
  'business_name',
] as const

export type DraftFactId = (typeof DRAFT_FACT_IDS)[number]

export type DraftFactValue = string | number

export interface DraftFact {
  id: DraftFactId
  value: DraftFactValue
}

/**
 * Every field a resolver is ALLOWED to read, plus every field this file
 * EXPLICITLY EXCLUDES (typed but never touched by a resolver below — see the
 * file header). The excluded fields are all optional so a caller that only
 * has the allowed half can still build a `DraftFactsSourceInput` without
 * inventing PII it doesn't have.
 */
export interface DraftFactsSourceInput {
  // ── Allowed (the ten facts above) ──────────────────────────────────────
  stage: string
  stageLabel: string
  ageInStageDays: number
  nextActionTitle: string | null
  nextActionDueAt: string | null
  /** The LABEL ("WhatsApp", "Teléfono", …) — never a contact value. Mirrors
   *  `lib/portfolio/resolver.ts#PREFERRED_CHANNEL_LABEL`'s own contract. */
  preferredChannel: string | null
  publicShopUrl: string | null
  previewUrl: string | null
  partnerDisplayName: string | null
  businessName: string

  // ── EXCLUDED — never read by any resolver below (build contract) ───────
  phoneE164?: string | null
  emailNormalized?: string | null
  whatsappE164?: string | null
  instagramHandle?: string | null
  objections?: string | null
  fitNote?: string | null
  promoterId?: string | null
  cohort?: string | null
  taskOutcomeNote?: string | null
  secretOrTokenValue?: string | null
}

/** The keys `DraftFactsSourceInput` types but that no resolver may read — used
 *  by `e2e/portfolio-draft.spec.ts` to re-derive the excluded population from
 *  this file's own interface rather than a hand-written list living only in
 *  the spec. Kept in sync with the interface above by construction: this
 *  array IS what the spec feeds a value for and checks never surfaces. */
export const EXCLUDED_SOURCE_KEYS = [
  'phoneE164',
  'emailNormalized',
  'whatsappE164',
  'instagramHandle',
  'objections',
  'fitNote',
  'promoterId',
  'cohort',
  'taskOutcomeNote',
  'secretOrTokenValue',
] as const

interface DraftFactDescriptor {
  id: DraftFactId
  /** Returns `null`/`undefined`/`''` when the source has nothing to say — the
   *  caller (`buildDraftFacts`) OMITS the fact entirely rather than emitting a
   *  placeholder. "Unsupported claims are excluded" starts here. */
  resolve: (input: DraftFactsSourceInput) => DraftFactValue | null | undefined
}

/** The allowlist, in the order of `DRAFT_FACT_IDS`. Each resolver reads
 *  EXACTLY one field off `DraftFactsSourceInput`'s allowed half — none reads a
 *  key from `EXCLUDED_SOURCE_KEYS`, which is the property
 *  `e2e/portfolio-draft.spec.ts` proves against this file's own source text. */
export const DRAFT_FACT_ALLOWLIST: readonly DraftFactDescriptor[] = [
  { id: 'stage', resolve: (i) => i.stage },
  { id: 'stage_label', resolve: (i) => i.stageLabel },
  { id: 'age_in_stage_days', resolve: (i) => i.ageInStageDays },
  { id: 'next_action_title', resolve: (i) => i.nextActionTitle },
  { id: 'next_action_due_at', resolve: (i) => i.nextActionDueAt },
  { id: 'preferred_channel', resolve: (i) => i.preferredChannel },
  { id: 'public_shop_url', resolve: (i) => i.publicShopUrl },
  { id: 'preview_url', resolve: (i) => i.previewUrl },
  { id: 'partner_display_name', resolve: (i) => i.partnerDisplayName },
  { id: 'business_name', resolve: (i) => i.businessName },
]

/**
 * CONSTRUCT the allowed fact set from the allowlist — never spread `input`
 * and delete what shouldn't be exposed (file header). A resolver returning
 * `null`/`undefined`/`''` means that fact is OMITTED, not blanked — the caller
 * (`composeDraft`) never sees a fact it can render as an empty placeholder.
 */
export function buildDraftFacts(input: DraftFactsSourceInput): DraftFact[] {
  const facts: DraftFact[] = []
  for (const { id, resolve } of DRAFT_FACT_ALLOWLIST) {
    const value = resolve(input)
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    facts.push({ id, value })
  }
  return facts
}

/** Convenience lookup for `draft-compose.ts` — never mutated, never exposed
 *  as anything other than a read-only map of what `buildDraftFacts` decided
 *  to include. */
export function factMap(facts: readonly DraftFact[]): Partial<Record<DraftFactId, DraftFactValue>> {
  const map: Partial<Record<DraftFactId, DraftFactValue>> = {}
  for (const f of facts) map[f.id] = f.value
  return map
}
