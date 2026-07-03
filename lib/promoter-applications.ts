/**
 * Promoter Funnel v2 · Sprint 2 — self-serve promoter applications (Supabase side).
 *
 * A pending REQUEST to become a promoter, distinct from `marketplace_promoters`
 * (lib/promoter.ts) — approving one calls the existing `createPromoter()` unchanged
 * and links the resulting row via `promoter_id`. Hand-minting (the admin "Nuevo
 * promotor" button) has no application and keeps working unchanged. Applications
 * are a concept Medusa has no notion of → Supabase (AGENTS rule #2).
 *
 * Pure + next-free so `validateApplicationInput` is directly unit-testable
 * (e2e/promoter-applications.spec.ts); the Supabase calls live here too, exactly
 * like lib/promoter.ts.
 *
 * Table (supabase/migrations/20260702130000_promoter_applications.sql):
 *   marketplace_promoter_applications
 *
 * Every function tolerates the table not existing yet (returns a safe default).
 */

import { db } from '@/lib/supabase'
import { createPromoter, type Promoter } from '@/lib/promoter'

// Dependency-free email shape check (deliberately NOT imported from lib/sweepstakes.ts —
// that module pulls in 'server-only' + a direct locales/es.json import via lib/dictionary.ts,
// which the Playwright api-project runner can't load when testing this pure seam).
function isValidEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())
}

export interface PromoterApplication {
  id: string
  name: string
  email: string
  whatsapp: string
  city: string | null
  motivation: string | null
  status: 'pending' | 'approved' | 'rejected'
  promoter_id: string | null
  created_at?: string
  decided_at?: string | null
}

const APPLICATION_COLUMNS =
  'id, name, email, whatsapp, city, motivation, status, promoter_id, created_at, decided_at'

// ── Validation (pure — no network) ────────────────────────────────────────────

export type ApplicationInput = {
  name?: string
  email?: string
  whatsapp?: string
  city?: string
  motivation?: string
  /** Honeypot field — a real applicant never fills this. Non-empty ⇒ treat as spam. */
  website?: string
}

export type ValidationResult =
  | { ok: true; clean: { name: string; email: string; whatsapp: string; city: string | null; motivation: string | null } }
  | { ok: false; reason: 'honeypot' | 'missing_fields' | 'invalid_email' | 'too_long' }

const MAX_NAME_LEN = 100
const MAX_WHATSAPP_LEN = 30
const MAX_CITY_LEN = 100
const MAX_MOTIVATION_LEN = 1000

/**
 * Validate a raw application submission. Checked in order: honeypot (silently
 * treated as spam, never surfaced as a distinct error to the caller — see the
 * route), required fields, email shape, then length caps so a malicious payload
 * can't blow up storage/notification copy.
 */
export function validateApplicationInput(input: ApplicationInput): ValidationResult {
  if ((input.website ?? '').trim().length > 0) return { ok: false, reason: 'honeypot' }

  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim()
  const whatsapp = (input.whatsapp ?? '').trim()
  const city = (input.city ?? '').trim()
  const motivation = (input.motivation ?? '').trim()

  if (!name || !email || !whatsapp) return { ok: false, reason: 'missing_fields' }
  if (!isValidEmailShape(email)) return { ok: false, reason: 'invalid_email' }
  if (name.length > MAX_NAME_LEN || whatsapp.length > MAX_WHATSAPP_LEN || city.length > MAX_CITY_LEN || motivation.length > MAX_MOTIVATION_LEN) {
    return { ok: false, reason: 'too_long' }
  }

  return {
    ok: true,
    clean: {
      name,
      email: email.toLowerCase(),
      whatsapp,
      city: city || null,
      motivation: motivation || null,
    },
  }
}

type RefusalReason = Extract<ValidationResult, { ok: false }>['reason']

/** es-MX message for a refused application (mirrors promoterRefusalMessage). */
export function applicationRefusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case 'honeypot':
      return 'No se pudo enviar la solicitud.' // never reveal the trap
    case 'missing_fields':
      return 'Completa tu nombre, correo y WhatsApp.'
    case 'invalid_email':
      return 'Ingresa un correo válido.'
    case 'too_long':
      return 'Alguno de los campos es demasiado largo.'
  }
}

// ── Application CRUD (Supabase) ───────────────────────────────────────────────

/**
 * Insert a new pending application. Returns the row, or null on DB error /
 * missing table (the route surfaces a generic failure — never leaks the cause).
 */
export async function createPromoterApplication(
  clean: { name: string; email: string; whatsapp: string; city: string | null; motivation: string | null },
): Promise<PromoterApplication | null> {
  const { data, error } = await db
    .from('marketplace_promoter_applications')
    .insert({ ...clean, status: 'pending' })
    .select(APPLICATION_COLUMNS)
    .maybeSingle()
  if (error || !data) {
    if (error && !/does not exist|relation/i.test(error.message ?? '')) {
      console.error('[promoter-applications] create failed:', error.message)
    }
    return null
  }
  return data as PromoterApplication
}

/** All applications, optionally filtered by status, newest first (admin console). */
export async function listPromoterApplications(status?: PromoterApplication['status']): Promise<PromoterApplication[]> {
  let query = db.from('marketplace_promoter_applications').select(APPLICATION_COLUMNS).order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error || !data) return []
  return data as PromoterApplication[]
}

/** Look up a single application by id. Null if not found / table missing. */
export async function getPromoterApplication(id: string): Promise<PromoterApplication | null> {
  if (!id) return null
  const { data, error } = await db
    .from('marketplace_promoter_applications')
    .select(APPLICATION_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as PromoterApplication
}

// ── Approve / reject transition (epic 08 · S2 · US-2.2) ───────────────────────

export type ApplicationTransitionDecision =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_transition' }

/**
 * Pure transition guard — mirrors resolvePromoterDiscount's shape (the caller
 * looks the row up via DB and passes it in, so this stays unit-testable without
 * a network call). Only a `pending` application may transition; an unknown
 * (null) or already-decided application is refused (idempotency / no double-mint).
 */
export function decideApplicationTransition(application: PromoterApplication | null): ApplicationTransitionDecision {
  if (!application) return { ok: false, reason: 'not_found' }
  if (application.status !== 'pending') return { ok: false, reason: 'invalid_transition' }
  return { ok: true }
}

export type DecideApplicationResult =
  | { ok: true; application: PromoterApplication; promoter?: Promoter }
  | { ok: false; reason: 'not_found' | 'invalid_transition' | 'mint_failed' }

/**
 * Approve a pending application: mints a fresh promoter code via the EXISTING
 * `createPromoter()` (unchanged), links it via `promoter_id`, and flips the
 * application to `approved`. Guarded by the pure `decideApplicationTransition`
 * seam above.
 */
export async function approvePromoterApplication(id: string): Promise<DecideApplicationResult> {
  const application = await getPromoterApplication(id)
  const decision = decideApplicationTransition(application)
  if (!decision.ok) return decision

  const promoter = await createPromoter(application!.name)
  if (!promoter) return { ok: false, reason: 'mint_failed' }

  const { data, error } = await db
    .from('marketplace_promoter_applications')
    .update({ status: 'approved', promoter_id: promoter.id, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select(APPLICATION_COLUMNS)
    .maybeSingle()
  if (error || !data) {
    if (error && !/does not exist|relation/i.test(error.message ?? '')) {
      console.error('[promoter-applications] approve update failed:', error.message)
    }
    // The promoter was already minted at this point — surfacing not_found/invalid_transition
    // here would hide a real code from the applicant, so tell the truth: the transition failed.
    return { ok: false, reason: 'invalid_transition' }
  }
  return { ok: true, application: data as PromoterApplication, promoter }
}

/**
 * Reject a pending application. Same pure transition guard as approve — no code
 * is ever minted on this path.
 */
export async function rejectPromoterApplication(id: string): Promise<DecideApplicationResult> {
  const application = await getPromoterApplication(id)
  const decision = decideApplicationTransition(application)
  if (!decision.ok) return decision

  const { data, error } = await db
    .from('marketplace_promoter_applications')
    .update({ status: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select(APPLICATION_COLUMNS)
    .maybeSingle()
  if (error || !data) {
    if (error && !/does not exist|relation/i.test(error.message ?? '')) {
      console.error('[promoter-applications] reject update failed:', error.message)
    }
    return { ok: false, reason: 'invalid_transition' }
  }
  return { ok: true, application: data as PromoterApplication }
}
