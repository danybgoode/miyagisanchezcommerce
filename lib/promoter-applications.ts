/**
 * One application seam for the legacy Mexican Promotor funnel and the versioned
 * founding-operator intake. Program track is descriptive; it never grants shops.
 */
import { db } from '@/lib/supabase'
import { createPromoter, type Promoter } from '@/lib/promoter'
import { canonicalCandidateShopUrl } from '@/lib/candidate-shop-url'
export { canonicalCandidateShopUrl } from '@/lib/candidate-shop-url'

function isValidEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())
}

export type ProgramTrack = 'promoter' | 'founding_operator'
export type MerchantAwareness = 'not_contacted' | 'aware_of_nomination' | 'interested_in_conversation'
export type CandidatePlatform = 'shopify' | 'woocommerce' | 'other'
export type CandidateChannel = 'online_store' | 'marketplace' | 'social' | 'wholesale' | 'other'

export interface CandidateShopV1 {
  url: string
  platform: CandidatePlatform
  channels: CandidateChannel[]
  merchant_awareness: MerchantAwareness
}

export interface OperatorDetailsV1 {
  company_name: string
  operator_role: string
  active_shop_count: number
  candidate_shops: [CandidateShopV1, CandidateShopV1, CandidateShopV1]
  recent_operating_problem: string
  must_retain_systems: string
  why_now: string
  checkpoint_90_day: true
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
  program_track: ProgramTrack
  operator_details_version: 1 | null
  operator_details: OperatorDetailsV1 | null
  activation_expires_at?: string | null
  activation_used_at?: string | null
  invitation_provider_status?: 'pending' | 'provider_accepted' | 'unconfirmed' | null
  invitation_attempt_count?: number | null
  invitation_attempted_at?: string | null
  invitation_provider_accepted_at?: string | null
  created_at?: string
  decided_at?: string | null
}

const APPLICATION_COLUMNS =
  'id, name, email, whatsapp, city, motivation, status, promoter_id, program_track, operator_details_version, operator_details, activation_expires_at, activation_used_at, invitation_provider_status, invitation_attempt_count, invitation_attempted_at, invitation_provider_accepted_at, created_at, decided_at'

/**
 * RPCs return the table's composite row, which includes the activation hash.
 * Rebuild the application from an explicit public/admin-safe field list before
 * any route can serialize it. Internal MYP identifiers live on the identity row
 * and are never selected here either.
 */
export function sanitizePromoterApplicationRow(value: unknown): PromoterApplication | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.email !== 'string' || typeof value.whatsapp !== 'string'
    || (value.program_track !== 'promoter' && value.program_track !== 'founding_operator')
    || (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'rejected')) return null

  return {
    id: value.id,
    name: value.name,
    email: value.email,
    whatsapp: value.whatsapp,
    city: typeof value.city === 'string' ? value.city : null,
    motivation: typeof value.motivation === 'string' ? value.motivation : null,
    status: value.status,
    promoter_id: typeof value.promoter_id === 'string' ? value.promoter_id : null,
    program_track: value.program_track,
    operator_details_version: value.operator_details_version === 1 ? 1 : null,
    operator_details: isRecord(value.operator_details) ? value.operator_details as unknown as OperatorDetailsV1 : null,
    activation_expires_at: typeof value.activation_expires_at === 'string' ? value.activation_expires_at : null,
    activation_used_at: typeof value.activation_used_at === 'string' ? value.activation_used_at : null,
    invitation_provider_status: value.invitation_provider_status === 'pending'
      || value.invitation_provider_status === 'provider_accepted'
      || value.invitation_provider_status === 'unconfirmed' ? value.invitation_provider_status : null,
    invitation_attempt_count: typeof value.invitation_attempt_count === 'number' ? value.invitation_attempt_count : null,
    invitation_attempted_at: typeof value.invitation_attempted_at === 'string' ? value.invitation_attempted_at : null,
    invitation_provider_accepted_at: typeof value.invitation_provider_accepted_at === 'string' ? value.invitation_provider_accepted_at : null,
    created_at: typeof value.created_at === 'string' ? value.created_at : undefined,
    decided_at: typeof value.decided_at === 'string' ? value.decided_at : null,
  }
}

export type ApplicationInput = {
  name?: unknown
  email?: unknown
  whatsapp?: unknown
  city?: unknown
  motivation?: unknown
  website?: unknown
  program_track?: unknown
  operator_details_version?: unknown
  operator_details?: unknown
  [key: string]: unknown
}

type PromoterClean = {
  name: string
  email: string
  whatsapp: string
  city: string | null
  motivation: string | null
}

type OperatorClean = {
  name: string
  email: string
  whatsapp: string
  city: null
  motivation: null
  program_track: 'founding_operator'
  operator_details_version: 1
  operator_details: OperatorDetailsV1
}

export type ApplicationRefusalReason =
  | 'honeypot' | 'missing_fields' | 'invalid_email' | 'too_long'
  | 'invalid_payload' | 'shop_count' | 'shop_url' | 'qualification'

export type ValidationResult =
  | { ok: true; clean: PromoterClean | OperatorClean }
  | { ok: false; reason: ApplicationRefusalReason }

const MAX_NAME_LEN = 100
const MAX_WHATSAPP_LEN = 30
const MAX_SHORT_LEN = 160
const MAX_LONG_LEN = 1200
const OPERATOR_TOP_LEVEL_KEYS = new Set([
  'name', 'email', 'whatsapp', 'website', 'program_track', 'operator_details_version', 'operator_details',
])
const OPERATOR_DETAIL_KEYS = new Set([
  'company_name', 'operator_role', 'active_shop_count', 'candidate_shops',
  'recent_operating_problem', 'must_retain_systems', 'why_now', 'checkpoint_90_day',
])
const SHOP_KEYS = new Set(['url', 'platform', 'channels', 'merchant_awareness'])
const PLATFORMS = new Set<CandidatePlatform>(['shopify', 'woocommerce', 'other'])
const CHANNELS = new Set<CandidateChannel>(['online_store', 'marketplace', 'social', 'wholesale', 'other'])
const AWARENESS = new Set<MerchantAwareness>(['not_contacted', 'aware_of_nomination', 'interested_in_conversation'])

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatePromoterInput(input: ApplicationInput): ValidationResult {
  if (stringValue(input.website)) return { ok: false, reason: 'honeypot' }
  const name = stringValue(input.name)
  const email = stringValue(input.email)
  const whatsapp = stringValue(input.whatsapp)
  const city = stringValue(input.city)
  const motivation = stringValue(input.motivation)
  if (!name || !email || !whatsapp) return { ok: false, reason: 'missing_fields' }
  if (!isValidEmailShape(email)) return { ok: false, reason: 'invalid_email' }
  if (name.length > MAX_NAME_LEN || whatsapp.length > MAX_WHATSAPP_LEN || city.length > 100 || motivation.length > 1000) {
    return { ok: false, reason: 'too_long' }
  }
  return { ok: true, clean: { name, email: email.toLowerCase(), whatsapp, city: city || null, motivation: motivation || null } }
}

function validateOperatorInput(input: ApplicationInput): ValidationResult {
  if (input.website !== undefined && typeof input.website !== 'string') return { ok: false, reason: 'invalid_payload' }
  if (stringValue(input.website)) return { ok: false, reason: 'honeypot' }
  if (!hasOnlyKeys(input, OPERATOR_TOP_LEVEL_KEYS) || input.operator_details_version !== 1 || !isRecord(input.operator_details)) {
    return { ok: false, reason: 'invalid_payload' }
  }
  const name = stringValue(input.name)
  const email = stringValue(input.email)
  const whatsapp = stringValue(input.whatsapp)
  if (!name || !email || !whatsapp) return { ok: false, reason: 'missing_fields' }
  if (!isValidEmailShape(email)) return { ok: false, reason: 'invalid_email' }
  if (name.length > MAX_NAME_LEN || whatsapp.length > MAX_WHATSAPP_LEN) return { ok: false, reason: 'too_long' }

  const details = input.operator_details
  if (!hasOnlyKeys(details, OPERATOR_DETAIL_KEYS)) return { ok: false, reason: 'invalid_payload' }
  const companyName = stringValue(details.company_name)
  const operatorRole = stringValue(details.operator_role)
  const activeShopCount = details.active_shop_count
  const recentProblem = stringValue(details.recent_operating_problem)
  const retainSystems = stringValue(details.must_retain_systems)
  const whyNow = stringValue(details.why_now)
  if (!companyName || !operatorRole || !Number.isInteger(activeShopCount) || (activeShopCount as number) < 3 || (activeShopCount as number) > 10000
    || !recentProblem || !retainSystems || !whyNow || details.checkpoint_90_day !== true) {
    return { ok: false, reason: Number(activeShopCount) < 3 ? 'shop_count' : 'qualification' }
  }
  if (companyName.length > MAX_SHORT_LEN || operatorRole.length > MAX_SHORT_LEN
    || [recentProblem, retainSystems, whyNow].some((value) => value.length > MAX_LONG_LEN)) {
    return { ok: false, reason: 'too_long' }
  }
  if (!Array.isArray(details.candidate_shops) || details.candidate_shops.length !== 3) return { ok: false, reason: 'shop_count' }

  const shops: CandidateShopV1[] = []
  for (const candidate of details.candidate_shops) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, SHOP_KEYS)) return { ok: false, reason: 'invalid_payload' }
    const url = canonicalCandidateShopUrl(candidate.url)
    const platform = candidate.platform
    const channels = candidate.channels
    const awareness = candidate.merchant_awareness
    if (!url) return { ok: false, reason: 'shop_url' }
    if (!PLATFORMS.has(platform as CandidatePlatform) || !Array.isArray(channels) || channels.length === 0
      || channels.length > CHANNELS.size || !channels.every((channel) => CHANNELS.has(channel as CandidateChannel))
      || new Set(channels).size !== channels.length || !AWARENESS.has(awareness as MerchantAwareness)) {
      return { ok: false, reason: 'qualification' }
    }
    shops.push({ url, platform: platform as CandidatePlatform, channels: channels as CandidateChannel[], merchant_awareness: awareness as MerchantAwareness })
  }
  if (new Set(shops.map((shop) => shop.url)).size !== 3) return { ok: false, reason: 'shop_url' }

  return {
    ok: true,
    clean: {
      name, email: email.toLowerCase(), whatsapp, city: null, motivation: null,
      program_track: 'founding_operator', operator_details_version: 1,
      operator_details: {
        company_name: companyName, operator_role: operatorRole, active_shop_count: activeShopCount as number,
        candidate_shops: shops as [CandidateShopV1, CandidateShopV1, CandidateShopV1],
        recent_operating_problem: recentProblem, must_retain_systems: retainSystems,
        why_now: whyNow, checkpoint_90_day: true,
      },
    },
  }
}

export function validateApplicationInput(input: ApplicationInput): ValidationResult {
  if (input.program_track === 'founding_operator') return validateOperatorInput(input)
  if (input.program_track === undefined || input.program_track === 'promoter') return validatePromoterInput(input)
  return { ok: false, reason: 'invalid_payload' }
}

export function applicationRefusalMessage(reason: ApplicationRefusalReason, track: ProgramTrack = 'promoter'): string {
  if (track === 'founding_operator') {
    const messages: Record<ApplicationRefusalReason, string> = {
      honeypot: 'We could not receive the application.', missing_fields: 'Complete your contact details.',
      invalid_email: 'Enter a valid email address.', too_long: 'One or more answers are too long.',
      invalid_payload: 'Review the application fields and try again.', shop_count: 'Include exactly three shops and confirm that you actively operate at least three.',
      shop_url: 'Each shop needs a public http or https URL.', qualification: 'Complete the operating profile and all three shop records.',
    }
    return messages[reason]
  }
  const messages: Record<ApplicationRefusalReason, string> = {
    honeypot: 'No se pudo enviar la solicitud.', missing_fields: 'Completa tu nombre, correo y WhatsApp.',
    invalid_email: 'Ingresa un correo válido.', too_long: 'Alguno de los campos es demasiado largo.',
    invalid_payload: 'Revisa los campos de la solicitud.', shop_count: 'Revisa las tiendas indicadas.',
    shop_url: 'Revisa las ligas indicadas.', qualification: 'Completa la solicitud.',
  }
  return messages[reason]
}

export type CreateApplicationResult = { application: PromoterApplication; created: boolean }

export async function createPromoterApplication(clean: PromoterClean | OperatorClean): Promise<CreateApplicationResult | null> {
  const { data, error } = await db.from('marketplace_promoter_applications')
    .insert({ ...clean, status: 'pending' }).select(APPLICATION_COLUMNS).maybeSingle()
  if (!error && data) return { application: data as PromoterApplication, created: true }

  if ('program_track' in clean && clean.program_track === 'founding_operator' && error?.code === '23505') {
    const { data: existing } = await db.from('marketplace_promoter_applications')
      .select(APPLICATION_COLUMNS).eq('program_track', 'founding_operator').eq('email', clean.email)
      .in('status', ['pending', 'approved']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (existing) return { application: existing as PromoterApplication, created: false }
  }
  if (error && !/does not exist|relation/i.test(error.message ?? '')) console.error('[promoter-applications] create failed:', error.message)
  return null
}

export async function listPromoterApplications(status?: PromoterApplication['status']): Promise<PromoterApplication[]> {
  let query = db.from('marketplace_promoter_applications').select(APPLICATION_COLUMNS).order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  return error || !data ? [] : data as PromoterApplication[]
}

export async function getPromoterApplication(id: string): Promise<PromoterApplication | null> {
  if (!id) return null
  const { data, error } = await db.from('marketplace_promoter_applications').select(APPLICATION_COLUMNS).eq('id', id).maybeSingle()
  return error || !data ? null : data as PromoterApplication
}

export type ApplicationTransitionDecision = { ok: true } | { ok: false; reason: 'not_found' | 'invalid_transition' }
export function decideApplicationTransition(application: PromoterApplication | null): ApplicationTransitionDecision {
  if (!application) return { ok: false, reason: 'not_found' }
  if (application.status !== 'pending') return { ok: false, reason: 'invalid_transition' }
  return { ok: true }
}

export type DecideApplicationResult =
  | { ok: true; application: PromoterApplication; promoter?: Promoter }
  | { ok: false; reason: 'not_found' | 'invalid_transition' | 'mint_failed' | 'operator_approval_unavailable' }

export async function approvePromoterApplication(id: string): Promise<DecideApplicationResult> {
  const application = await getPromoterApplication(id)
  const decision = decideApplicationTransition(application)
  if (!decision.ok) return decision
  // Sprint 2 consumes the transactional SQL primitive. Never mint an MYP operator
  // through the legacy PRM route while that neutral invitation path is absent.
  if (application!.program_track === 'founding_operator') return { ok: false, reason: 'operator_approval_unavailable' }

  const { data: claimed, error: claimError } = await db.from('marketplace_promoter_applications')
    .update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending')
    .select(APPLICATION_COLUMNS).maybeSingle()
  if (claimError || !claimed) return { ok: false, reason: 'invalid_transition' }
  const promoter = await createPromoter(claimed.name)
  if (!promoter) {
    await db.from('marketplace_promoter_applications').update({ status: 'pending', decided_at: null }).eq('id', id)
    return { ok: false, reason: 'mint_failed' }
  }
  const { data, error } = await db.from('marketplace_promoter_applications').update({ promoter_id: promoter.id })
    .eq('id', id).select(APPLICATION_COLUMNS).maybeSingle()
  return error || !data
    ? { ok: true, application: { ...(claimed as PromoterApplication), promoter_id: promoter.id }, promoter }
    : { ok: true, application: data as PromoterApplication, promoter }
}

export async function rejectPromoterApplication(id: string): Promise<DecideApplicationResult> {
  const application = await getPromoterApplication(id)
  const decision = decideApplicationTransition(application)
  if (!decision.ok) return decision
  const { data, error } = await db.from('marketplace_promoter_applications')
    .update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending')
    .select(APPLICATION_COLUMNS).maybeSingle()
  return error || !data ? { ok: false, reason: 'invalid_transition' } : { ok: true, application: data as PromoterApplication }
}

type RpcError = { code?: string; message?: string } | null
type ApplicationRpcDeps = {
  rpc: (functionName: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>
}
const applicationRpcDeps: ApplicationRpcDeps = {
  rpc: (functionName, args) => db.rpc(functionName, args),
}

export type FoundingOperatorMutationResult =
  | { ok: true; application: PromoterApplication }
  | { ok: false; reason: 'not_found' | 'invalid_transition' | 'unavailable' }

async function callFoundingOperatorRpc(
  functionName: string,
  args: Record<string, unknown>,
  deps: ApplicationRpcDeps,
): Promise<FoundingOperatorMutationResult> {
  const { data, error } = await deps.rpc(functionName, args)
  if (error) {
    const reason = error.code === 'P0002' || /not_found/.test(error.message ?? '')
      ? 'not_found'
      : error.code === '55000' || error.code === '23505' || /invalid|already|stale|mismatch|expired|used/.test(error.message ?? '')
        ? 'invalid_transition'
        : 'unavailable'
    // Never log args: activation hashes are deliberately opaque even in logs.
    if (reason === 'unavailable') console.error(`[founding-operator] ${functionName} unavailable (${error.code ?? 'unknown'})`)
    return { ok: false, reason }
  }
  const application = sanitizePromoterApplicationRow(Array.isArray(data) ? data[0] : data)
  return application ? { ok: true, application } : { ok: false, reason: 'unavailable' }
}

export function approveFoundingOperatorApplication(
  applicationId: string,
  activationTokenHash: string,
  activationExpiresAt: string,
  deps: ApplicationRpcDeps = applicationRpcDeps,
): Promise<FoundingOperatorMutationResult> {
  return callFoundingOperatorRpc('miyagi_approve_founding_operator_application', {
    p_application_id: applicationId,
    p_activation_token_hash: activationTokenHash,
    p_activation_expires_at: activationExpiresAt,
  }, deps)
}

export function rotateFoundingOperatorInvitation(
  applicationId: string,
  activationTokenHash: string,
  activationExpiresAt: string,
  deps: ApplicationRpcDeps = applicationRpcDeps,
): Promise<FoundingOperatorMutationResult> {
  return callFoundingOperatorRpc('miyagi_rotate_founding_operator_invitation', {
    p_application_id: applicationId,
    p_activation_token_hash: activationTokenHash,
    p_activation_expires_at: activationExpiresAt,
  }, deps)
}

export function recordFoundingOperatorInvitationOutcome(
  applicationId: string,
  activationTokenHash: string,
  providerOutcome: 'provider_accepted' | 'unconfirmed',
  deps: ApplicationRpcDeps = applicationRpcDeps,
): Promise<FoundingOperatorMutationResult> {
  return callFoundingOperatorRpc('miyagi_record_founding_operator_invitation_outcome', {
    p_application_id: applicationId,
    p_activation_token_hash: activationTokenHash,
    p_provider_outcome: providerOutcome,
  }, deps)
}

export function activateFoundingOperator(
  activationTokenHash: string,
  clerkUserId: string,
  verifiedEmails: string[],
  deps: ApplicationRpcDeps = applicationRpcDeps,
): Promise<FoundingOperatorMutationResult> {
  return callFoundingOperatorRpc('miyagi_activate_founding_operator', {
    p_activation_token_hash: activationTokenHash,
    p_clerk_user_id: clerkUserId,
    p_verified_emails: verifiedEmails,
  }, deps)
}
