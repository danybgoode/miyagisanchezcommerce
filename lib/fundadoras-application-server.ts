/**
 * lib/fundadoras-application-server.ts
 *
 * Tiendas Fundadoras acquisition — the SERVER-ONLY half of the public
 * application (the DB + network work the pure `lib/fundadoras-application.ts`
 * only decides). Mirrors the relationship-access.ts / relationship-enrich.ts
 * split: all the Supabase reads/writes and the promoter-code resolution live
 * here so the pure file stays loadable by the Playwright `api` runner.
 *
 * Everything here writes into the ONE canonical `merchant_relationships` row
 * (never a second leads table, epic Decision 3) plus its append-only
 * `merchant_relationship_consents` ledger.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { getPromoterByCode } from '@/lib/promoter'
import {
  decideDedupeMatch,
  type DedupeCandidateRows,
  buildFundadorasEnrichPatch,
  buildFundadorasInsertPayload,
  buildFundadorasConsentRows,
  FUNDADORAS_COHORT,
  type FundadorasCleanApplication,
  type ExistingRelationshipFacts,
} from '@/lib/fundadoras-application'

/**
 * The canonical capacity read (Story 1.3) — how many founding-cohort members
 * already exist, counted from the canonical rows, NEVER a client counter.
 * `count: 'exact'` (LEARNINGS: never infer a total from how many rows came
 * back). A read error fails CLOSED to a sentinel the caller treats as "assume
 * full" — a capacity check that can't see the data must not wave an
 * application through.
 */
export async function readFundadorasCapacityUsed(): Promise<number | null> {
  const { count, error } = await db
    .from('merchant_relationships')
    .select('id', { count: 'exact', head: true })
    .eq('cohort', FUNDADORAS_COHORT)
    .neq('qualification', 'disqualified')
  if (error || count === null) return null
  return count
}

/** Outcome of persisting one application. `existed` is deliberately NOT
 *  surfaced to the public caller (non-leak) — it exists only so the route can
 *  decide whether to emit the accepted event (a fresh accept) and for logs. */
export type PersistOutcome =
  | { ok: true; relationshipId: string; created: boolean; idempotentReplay: boolean }
  | { ok: false }

/**
 * Persist one validated application into the canonical record. Order:
 *   1. Idempotency: an existing row carrying this key ⇒ return it, no second
 *      write, no second accepted event (`idempotentReplay: true`).
 *   2. Resolve the promoter code (invalid ⇒ null, dropped silently).
 *   3. Dedupe by phone/email (precedence in `decideDedupeMatch`): a hit ⇒
 *      ENRICH (fill-only patch); a miss ⇒ INSERT a new row.
 *   4. Append the consent ledger rows.
 * Every DB failure returns `{ ok: false }` — the route surfaces a generic 502
 * and nothing partial is claimed.
 */
export async function persistFundadorasApplication(clean: FundadorasCleanApplication): Promise<PersistOutcome> {
  const nowIso = new Date().toISOString()

  // 1. Idempotency — a retried submission with the same key is a no-op replay.
  if (clean.idempotencyKey) {
    const { data: existingByKey, error: keyErr } = await db
      .from('merchant_relationships')
      .select('id')
      .eq('application_idempotency_key', clean.idempotencyKey)
      .maybeSingle()
    if (keyErr) return { ok: false }
    if (existingByKey) {
      return { ok: true, relationshipId: existingByKey.id, created: false, idempotentReplay: true }
    }
  }

  // 2. Resolve promoter attribution (invalid code ⇒ null, silently dropped).
  let resolvedPromoterId: string | null = null
  if (clean.promoterCode) {
    const promoter = await getPromoterByCode(clean.promoterCode)
    resolvedPromoterId = promoter?.id ?? null
  }

  // 3. Dedupe lookups (phone, then email — shop_id never applies to a public
  //    applicant who has no shop yet).
  const candidates: DedupeCandidateRows = { byShopId: null, byPhone: null, byEmail: null }
  if (clean.phone) {
    const { data, error } = await db
      .from('merchant_relationships')
      .select('id')
      .eq('phone_e164', clean.phone)
      .limit(1)
      .maybeSingle()
    if (error) return { ok: false }
    candidates.byPhone = data ?? null
  }
  if (clean.email) {
    const { data, error } = await db
      .from('merchant_relationships')
      .select('id')
      .eq('email_normalized', clean.email)
      .limit(1)
      .maybeSingle()
    if (error) return { ok: false }
    candidates.byEmail = data ?? null
  }

  const dedupe = decideDedupeMatch(candidates)

  let relationshipId: string
  let created: boolean

  if (dedupe.matched) {
    // ENRICH — read the row's current facts, build a fill-only patch, update.
    const { data: existing, error: readErr } = await db
      .from('merchant_relationships')
      .select(
        'business_name, contact_name, phone_e164, email_normalized, estado, municipio, category, current_channels, preferred_channel, promoter_id, cohort, utm, applied_at, application_idempotency_key',
      )
      .eq('id', dedupe.relationshipId)
      .maybeSingle()
    if (readErr || !existing) return { ok: false }

    // `buildFundadorasEnrichPatch` handles the idempotency key fill-only (never
    // clobbers an existing one) alongside every other field.
    const patch = buildFundadorasEnrichPatch(existing as ExistingRelationshipFacts, clean, resolvedPromoterId, nowIso)
    if (Object.keys(patch).length > 0) {
      patch.updated_at = nowIso
      const { error: updErr } = await db.from('merchant_relationships').update(patch).eq('id', dedupe.relationshipId)
      if (updErr) return { ok: false }
    }
    relationshipId = dedupe.relationshipId
    created = false
  } else {
    // INSERT — a brand-new founding applicant.
    const payload = buildFundadorasInsertPayload(clean, resolvedPromoterId, nowIso)
    const { data: inserted, error: insErr } = await db
      .from('merchant_relationships')
      .insert(payload)
      .select('id')
      .single()
    if (insErr || !inserted) return { ok: false }
    relationshipId = inserted.id
    created = true
  }

  // 4. Append-only consent ledger (contact granted:true; preview/marketing
  //    carry the actual choice, defaulting to false — never fabricated).
  const consentRows = buildFundadorasConsentRows(clean).map((r) => ({ ...r, relationship_id: relationshipId }))
  const { error: consentErr } = await db.from('merchant_relationship_consents').insert(consentRows)
  if (consentErr) return { ok: false }

  return { ok: true, relationshipId, created, idempotentReplay: false }
}
