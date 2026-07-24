/**
 * lib/fundadoras-application.ts
 *
 * Tiendas Fundadoras acquisition campaign (epic tiendas-fundadoras-acquisition,
 * Stories 2.1–2.3) — pure validation, capacity-gate, dedupe/enrich, consent-row,
 * and PII-free-event decisions for `POST /api/vende/fundadoras/apply` and
 * `POST /api/growth/fundadoras/track`. Zero-import except two other zero-import
 * lib files (`lib/merchant-identity.ts`, `lib/seller-acquisition.ts`) — same
 * convention as `lib/promoter-applications.ts` / `lib/relationship-access.ts`'s
 * pure half — so the Playwright `api` runner can walk every branch with no
 * DB/Clerk/`next/cache`.
 *
 * The founding-cohort membership is NOT a second leads table — it lives on the
 * SAME canonical `merchant_relationships` row every other merchant-acquisition
 * surface writes (epic Decision 3; schema contract:
 * supabase/migrations/20260724120000_fundadoras_acquisition.sql). This file only
 * DECIDES what to write; the actual DB calls live in the server-only companion,
 * `lib/fundadoras-application-server.ts` (mirrors relationship-access.ts /
 * relationship-enrich.ts's split).
 */
import {
  normalizePhoneE164,
  normalizeEmail,
  decideDedupeMatch,
  type DedupeCandidateRows,
  type DedupeDecision,
} from './merchant-identity'
import { parseSellerAcquisitionUtm, type SellerAcquisitionUtm } from './seller-acquisition'
import type { GrowthTrackInput } from './growth-track'

export { decideDedupeMatch, type DedupeCandidateRows, type DedupeDecision }

// ── Build-contract constants ────────────────────────────────────────────────

/** The finite founding-cohort size (Story 1.3 / migration comment). */
export const FUNDADORAS_COHORT_CAPACITY = 25
/** `merchant_relationships.cohort` value that marks founding-cohort membership. */
export const FUNDADORAS_COHORT = 'fundadoras'
/** Bumped whenever the consent copy shown at the public form changes (Story 2.2). */
export const FUNDADORAS_CONSENT_TEXT_VERSION = 'fundadoras-apply-v1'
export const FUNDADORAS_CONSENT_SOURCE = 'fundadoras_public_application'
/** `merchant_relationships.created_by` for a row that originated here. */
export const FUNDADORAS_CREATED_BY = 'fundadoras_public'
export const FUNDADORAS_DEFAULT_SOURCE = 'public_application'

const PREFERRED_CHANNELS = ['whatsapp', 'phone', 'email', 'instagram', 'in_person'] as const
export type FundadorasPreferredChannel = (typeof PREFERRED_CHANNELS)[number]

const MAX_BUSINESS_NAME_LEN = 140
const MAX_CONTACT_NAME_LEN = 140
const MAX_LOCATION_LEN = 100
const MAX_CATEGORY_LEN = 100
const MAX_PROMOTER_CODE_LEN = 20

// ── Input / validation ───────────────────────────────────────────────────────

export interface FundadorasApplicationInput {
  businessName?: string
  contactName?: string
  phone?: string
  email?: string
  estado?: string
  municipio?: string
  category?: string
  currentChannel?: string
  preferredChannel?: string
  promoterCode?: string
  utm?: Record<string, string | string[] | undefined | null>
  contactConsent?: boolean
  previewPermission?: boolean
  marketing?: boolean
  idempotencyKey?: string
  /** Honeypot — a real applicant never fills this. Non-empty ⇒ treat as spam. */
  website?: string
}

export interface FundadorasCleanApplication {
  businessName: string
  contactName: string
  phone: string | null
  email: string | null
  estado: string | null
  municipio: string | null
  category: string | null
  currentChannel: string | null
  preferredChannel: FundadorasPreferredChannel | null
  promoterCode: string | null
  utm: SellerAcquisitionUtm
  contactConsent: true
  previewPermission: boolean
  marketing: boolean
  idempotencyKey: string | null
}

export type FundadorasRefusalReason =
  | 'honeypot'
  | 'missing_fields'
  | 'missing_contact'
  | 'invalid_phone'
  | 'invalid_email'
  | 'consent_required'
  | 'too_long'

export type FundadorasValidationResult =
  | { ok: true; clean: FundadorasCleanApplication }
  | { ok: false; reason: FundadorasRefusalReason }

function trimmed(v: string | undefined): string {
  return (v ?? '').trim()
}

/** Cap a free-text OPTIONAL field: blank → null, over-cap → null (dropped, never
 *  a hard refusal — only the required identity fields can 400 the whole application). */
function capOptional(v: string, max: number): string | null {
  const t = v.trim()
  if (!t) return null
  return t.length > max ? null : t
}

/**
 * Validate + normalize a raw public application. Checked in order: honeypot
 * (silently treated as spam, never surfaced as a distinct error — mirrors
 * `lib/promoter-applications.ts`), required identity fields, at-least-one
 * contact channel, contact-field SHAPE (reusing the same normalizers the
 * internal capture route trusts, `lib/merchant-identity.ts`), REQUIRED
 * explicit contact consent, then length caps. `website` (honeypot) is checked
 * first so a bot never even reaches the real validation branches.
 */
export function validateFundadorasApplicationInput(input: FundadorasApplicationInput): FundadorasValidationResult {
  if (trimmed(input.website).length > 0) return { ok: false, reason: 'honeypot' }

  const businessName = trimmed(input.businessName)
  const contactName = trimmed(input.contactName)
  if (!businessName || !contactName) return { ok: false, reason: 'missing_fields' }
  if (businessName.length > MAX_BUSINESS_NAME_LEN || contactName.length > MAX_CONTACT_NAME_LEN) {
    return { ok: false, reason: 'too_long' }
  }

  const rawPhone = trimmed(input.phone)
  const rawEmail = trimmed(input.email)
  if (!rawPhone && !rawEmail) return { ok: false, reason: 'missing_contact' }

  let phone: string | null = null
  if (rawPhone) {
    phone = normalizePhoneE164(rawPhone)
    if (!phone) return { ok: false, reason: 'invalid_phone' }
  }
  let email: string | null = null
  if (rawEmail) {
    email = normalizeEmail(rawEmail)
    if (!email) return { ok: false, reason: 'invalid_email' }
  }
  if (!phone && !email) return { ok: false, reason: 'missing_contact' }

  // Fail-closed on consent (LEARNINGS: consent defaults to NOT granted) — must
  // be the literal boolean `true`, never a truthy coercion of some other value.
  if (input.contactConsent !== true) return { ok: false, reason: 'consent_required' }

  const estado = capOptional(trimmed(input.estado), MAX_LOCATION_LEN)
  const municipio = capOptional(trimmed(input.municipio), MAX_LOCATION_LEN)
  const category = capOptional(trimmed(input.category), MAX_CATEGORY_LEN)
  const currentChannel = capOptional(trimmed(input.currentChannel), MAX_CATEGORY_LEN)

  const rawPreferred = trimmed(input.preferredChannel)
  const preferredChannel = (PREFERRED_CHANNELS as readonly string[]).includes(rawPreferred)
    ? (rawPreferred as FundadorasPreferredChannel)
    : null

  // An invalid/unresolvable promoter code is dropped SILENTLY (build contract,
  // Story 2.1) — shape isn't even checked here; the server-only companion
  // resolves it via the existing `getPromoterByCode` primitive, which itself
  // returns null for anything unknown.
  const promoterCode = capOptional(trimmed(input.promoterCode), MAX_PROMOTER_CODE_LEN)

  const idempotencyKey = trimmed(input.idempotencyKey) || null

  return {
    ok: true,
    clean: {
      businessName,
      contactName,
      phone,
      email,
      estado,
      municipio,
      category,
      currentChannel,
      preferredChannel,
      promoterCode,
      utm: parseSellerAcquisitionUtm(input.utm ?? undefined),
      contactConsent: true,
      previewPermission: input.previewPermission === true,
      marketing: input.marketing === true,
      idempotencyKey,
    },
  }
}

/** es-MX refusal copy. Never distinguishes "this phone/email already exists"
 *  from any other shape problem (non-leak requirement, Story 2.1 acceptance 5) —
 *  every reason here is purely about the SHAPE of what was submitted. */
export function fundadorasApplicationRefusalMessage(reason: FundadorasRefusalReason): string {
  switch (reason) {
    case 'honeypot':
      return 'No se pudo enviar la solicitud.' // never reveal the trap
    case 'missing_fields':
      return 'Completa el nombre del negocio y tu nombre de contacto.'
    case 'missing_contact':
      return 'Agrega un teléfono o un correo de contacto.'
    case 'invalid_phone':
      return 'Ingresa un teléfono válido.'
    case 'invalid_email':
      return 'Ingresa un correo válido.'
    case 'consent_required':
      return 'Necesitamos tu permiso para contactarte antes de enviar la solicitud.'
    case 'too_long':
      return 'Alguno de los campos es demasiado largo.'
  }
}

// ── Capacity-aware gate (Story 1.3) — server-derived, never a client counter ─

export type FundadorasGateState = 'closed' | 'open' | 'full'

/**
 * Decide the page/route state from server-only facts: the dark-launch flag
 * and the CANONICAL capacity count (never a client-supplied counter). Flag
 * OFF always wins (closed) regardless of capacity; flag ON defers to whether
 * the cohort is already full. Pure so the route and the page can never
 * disagree about which state a given (flag, capacityUsed) pair produces.
 */
export function decideFundadorasGateState(
  flagEnabled: boolean,
  capacityUsed: number,
  capacityLimit: number = FUNDADORAS_COHORT_CAPACITY,
): FundadorasGateState {
  if (!flagEnabled) return 'closed'
  if (capacityUsed >= capacityLimit) return 'full'
  return 'open'
}

// ── Enrich (never overwrite a deliberately-set value) ───────────────────────

/** The subset of a `merchant_relationships` row the enrich decision needs. */
export interface ExistingRelationshipFacts {
  business_name: string | null
  contact_name: string | null
  phone_e164: string | null
  email_normalized: string | null
  estado: string | null
  municipio: string | null
  category: string | null
  current_channels: string[] | null
  preferred_channel: string | null
  promoter_id: string | null
  cohort: string | null
  utm: Record<string, unknown> | null
  applied_at: string | null
  application_idempotency_key: string | null
}

/**
 * Build the UPDATE patch for an existing relationship matched by dedupe
 * ("ENRICH" — build contract, Story 2.1). Fills only fields the row doesn't
 * already have; a value the row already carries — however it got there,
 * e.g. from a promoter's field capture — is NEVER overwritten by a public
 * re-applicant's submission. `cohort` is the one field always ASSERTED
 * (never conditionally filled): a founding-campaign applicant belongs to the
 * cohort by definition, regardless of how the row was first created.
 * `resolvedPromoterId` is the ALREADY-resolved id (or null) — this function
 * stays pure and never touches the network.
 */
export function buildFundadorasEnrichPatch(
  existing: ExistingRelationshipFacts,
  clean: FundadorasCleanApplication,
  resolvedPromoterId: string | null,
  nowIso: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  if (!existing.business_name) patch.business_name = clean.businessName
  if (!existing.contact_name) patch.contact_name = clean.contactName
  if (!existing.phone_e164 && clean.phone) patch.phone_e164 = clean.phone
  if (!existing.email_normalized && clean.email) patch.email_normalized = clean.email
  if (!existing.estado && clean.estado) patch.estado = clean.estado
  if (!existing.municipio && clean.municipio) patch.municipio = clean.municipio
  if (!existing.category && clean.category) patch.category = clean.category
  if ((!existing.current_channels || existing.current_channels.length === 0) && clean.currentChannel) {
    patch.current_channels = [clean.currentChannel]
  }
  if (!existing.preferred_channel && clean.preferredChannel) patch.preferred_channel = clean.preferredChannel
  if (!existing.promoter_id && resolvedPromoterId) patch.promoter_id = resolvedPromoterId
  if (!existing.utm && Object.keys(clean.utm).length > 0) patch.utm = clean.utm
  if (!existing.applied_at) patch.applied_at = nowIso
  if (existing.cohort !== FUNDADORAS_COHORT) patch.cohort = FUNDADORAS_COHORT
  // Carry this submission's idempotency key forward ONLY when the row doesn't
  // already hold one — never CLOBBER an existing key (fill-only, like every
  // other field). Overwriting it would strand the ORIGINAL submission's replay:
  // its retry would no longer match, fall through to a second enrich, and
  // re-append consent + re-emit the accepted event.
  if (clean.idempotencyKey && !existing.application_idempotency_key) {
    patch.application_idempotency_key = clean.idempotencyKey
  }

  return patch
}

/** Build the INSERT row for a brand-new application (no dedupe match). */
export function buildFundadorasInsertPayload(
  clean: FundadorasCleanApplication,
  resolvedPromoterId: string | null,
  nowIso: string,
): Record<string, unknown> {
  return {
    business_name: clean.businessName,
    contact_name: clean.contactName,
    phone_e164: clean.phone,
    email_normalized: clean.email,
    estado: clean.estado,
    municipio: clean.municipio,
    category: clean.category,
    current_channels: clean.currentChannel ? [clean.currentChannel] : null,
    preferred_channel: clean.preferredChannel,
    promoter_id: resolvedPromoterId,
    cohort: FUNDADORAS_COHORT,
    source: clean.utm.utm_source ?? FUNDADORAS_DEFAULT_SOURCE,
    utm: Object.keys(clean.utm).length > 0 ? clean.utm : null,
    applied_at: nowIso,
    created_by: FUNDADORAS_CREATED_BY,
    application_idempotency_key: clean.idempotencyKey,
  }
}

// ── Consent ledger rows (Story 2.2 — never fabricate a granted=true) ────────

export interface FundadorasConsentRowInput {
  kind: 'contact' | 'preview_permission' | 'marketing'
  granted: boolean
  text_version: string
  source: string
  actor: 'applicant'
}

/**
 * One append-only row per consent KIND, always. `contact` is always
 * `granted:true` (the validator refuses the whole application otherwise);
 * `preview_permission`/`marketing` carry whatever the applicant actually
 * chose, DEFAULTING to `false` — an omitted/unchecked box can only ever
 * produce `granted:false` here, never `granted:true` (build contract:
 * "omission fabricates no permission").
 */
export function buildFundadorasConsentRows(clean: FundadorasCleanApplication): FundadorasConsentRowInput[] {
  const base = { text_version: FUNDADORAS_CONSENT_TEXT_VERSION, source: FUNDADORAS_CONSENT_SOURCE, actor: 'applicant' as const }
  return [
    { kind: 'contact', granted: true, ...base },
    { kind: 'preview_permission', granted: clean.previewPermission, ...base },
    { kind: 'marketing', granted: clean.marketing, ...base },
  ]
}

// ── PII-free funnel events (Story 2.3) ──────────────────────────────────────

export const FUNDADORAS_ALLOWED_EVENTS = [
  'fundadoras_view',
  'fundadoras_cta',
  'fundadoras_application_start',
  'fundadoras_validation_failed',
  'fundadoras_application_accepted',
] as const
export type FundadorasEventName = (typeof FUNDADORAS_ALLOWED_EVENTS)[number]

/** True only for a name on the fixed campaign event vocabulary — reject anything else. */
export function isFundadorasEvent(event: string): event is FundadorasEventName {
  return (FUNDADORAS_ALLOWED_EVENTS as readonly string[]).includes(event)
}

/** The ONLY tag keys a funnel event may carry — no free text, no form values. */
const ALLOWED_TAG_KEYS = ['utm_source', 'cohort_state'] as const
const MAX_TAG_VALUE_LEN = 140

function sanitizeTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!tags) return out
  for (const key of ALLOWED_TAG_KEYS) {
    const value = tags[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      out[key] = value.trim().slice(0, MAX_TAG_VALUE_LEN)
    }
  }
  return out
}

/**
 * Build the growth-event payload SERVER-SIDE BY CONSTRUCTION — only the event
 * name, an opaque subject id, and the allowlisted tags ever make it in. A
 * caller (client or route) handing this function an object stuffed with
 * `{businessName, phone, email, ...}` gets every one of those keys silently
 * dropped — there is no code path here that can forward an unlisted key.
 */
export function buildFundadorasEventPayload(
  event: FundadorasEventName,
  subjectId: string,
  tags?: Record<string, unknown>,
): GrowthTrackInput {
  return { userId: subjectId, event, tags: sanitizeTags(tags) }
}

const MIN_SUBJECT_ID_LEN = 8
const MAX_SUBJECT_ID_LEN = 128

/**
 * A cheap heuristic floor against an obviously PII-shaped "opaque" subject id
 * (an email, a phone number, a name with spaces). The client is SUPPOSED to
 * generate a random opaque token (Story 2.3 build contract: "NOT an
 * email/phone/name/IP") — the server never trusts that on faith. This is not
 * proof of randomness (unchecked), just a floor that rejects shapes that are
 * definitely NOT an opaque token.
 */
export function isPlausibleOpaqueSubjectId(id: string): boolean {
  const t = id.trim()
  if (t.length < MIN_SUBJECT_ID_LEN || t.length > MAX_SUBJECT_ID_LEN) return false
  if (t.includes('@')) return false // looks like an email
  if (/\s/.test(t)) return false // looks like a name
  if (/^\+?\d{7,}$/.test(t)) return false // looks like a phone number
  return true
}
