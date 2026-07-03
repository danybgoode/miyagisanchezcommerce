/**
 * Print Edition domain — shared types + constants.
 *
 * The sellable placement is a Medusa product; these types describe the
 * non-commerce editorial layer stored in Supabase (print_providers,
 * print_editions, print_ad_submissions). See supabase/migrations/*_print_edition.sql.
 */

// ── Tiers ──────────────────────────────────────────────────────────────────────

export type PrintTierKey = 'full' | 'half' | 'quarter' | 'card'

/** A purchasable ad size within an edition, mapped to a Medusa placement product. */
export interface PrintTier {
  key: PrintTierKey
  label: string
  price_cents: number
  capacity: number
  /** Medusa product id created for this tier when the edition is saved. */
  medusa_product_id?: string | null
}

export const PRINT_TIER_KEYS: PrintTierKey[] = ['full', 'half', 'quarter', 'card']

/** Default labels (es) used to scaffold a new edition's tier editor. */
export const PRINT_TIER_DEFAULTS: Record<PrintTierKey, { label: string; capacity: number }> = {
  full:    { label: 'Plana completa', capacity: 4 },
  half:    { label: 'Media plana',    capacity: 8 },
  quarter: { label: 'Un cuarto',      capacity: 16 },
  card:    { label: 'Tarjeta',        capacity: 24 },
}

// ── Provider ─────────────────────────────────────────────────────────────────

export interface PrintFileSpec {
  trim_size?: string
  bleed_mm?: number
  dpi?: number
  color_mode?: string
  pdf_standard?: string
  fonts?: string
  ink_limit?: number
}

export interface PrintProvider {
  id: string
  slug: string
  name: string
  description: string | null
  is_default: boolean
  active: boolean
  location: string | null
  coverage_zones: string[]
  distribution_notes: string | null
  schedule_notes: string | null
  preview_url: string | null
  file_spec: PrintFileSpec
  created_at: string
  updated_at: string
}

// ── Edition ────────────────────────────────────────────────────────────────────

export type PrintEditionStatus =
  | 'draft'
  | 'open'
  | 'closed'
  | 'in_production'
  | 'distributed'

export interface PrintEdition {
  id: string
  provider_id: string
  title: string
  status: PrintEditionStatus
  submission_deadline: string | null
  distribution_date: string | null
  coverage_zones: string[]
  tiers: PrintTier[]
  created_at: string
  updated_at: string
}

/** Edition shape returned to the seller portal, with live remaining capacity per tier. */
export interface PrintEditionPublic extends Pick<
  PrintEdition,
  'id' | 'title' | 'status' | 'submission_deadline' | 'distribution_date' | 'coverage_zones'
> {
  provider_name: string
  tiers: Array<PrintTier & { remaining: number; sold_out: boolean }>
}

// ── Submission ───────────────────────────────────────────────────────────────

export type PrintSubmissionStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'approved'
  | 'placed'
  | 'rejected'
  | 'refunded'

/** Statuses that consume a tier slot for capacity accounting. */
export const PRINT_OCCUPYING_STATUSES: PrintSubmissionStatus[] = [
  'pending_payment',
  'paid',
  'approved',
  'placed',
]

/**
 * The one status transition the print-studio (zine) machine surface may make —
 * `approved ⇄ placed`, and nothing else (no refunds, no rejections, no touching
 * `paid`). Pure so it's directly unit-testable without hitting the route.
 */
export function isValidStudioTransition(
  from: PrintSubmissionStatus,
  to: PrintSubmissionStatus,
): boolean {
  return (from === 'approved' && to === 'placed') || (from === 'placed' && to === 'approved')
}

export interface PrintCtaTarget {
  type: 'listing' | 'shop'
  id: string
  url: string
}

export interface PrintAdContent {
  headline?: string
  subhead?: string
  body?: string
  logo_url?: string | null
  photos?: string[]
  contact?: {
    whatsapp_seller?: string | null
    phone?: string | null
    whatsapp_central?: string | null
  }
  cta_target?: PrintCtaTarget | null
  featured_listing_ids?: string[]
  template_choice?: string | null
  /** R2 URL of the generated QR code (set during production/export). */
  qr_url?: string | null
  /** Manual payment instructions snapshot (for SPEI/DiMo/cash placements). */
  manual_payment?: {
    spei?: { clabe?: string | null; bank_name?: string | null; account_holder?: string | null } | null
    dimo?: { phone?: string | null } | null
    cash?: { note?: string | null } | null
  } | null
  /** Buyer signalled they sent a manual payment. */
  payment_reported?: boolean
  payment_reported_at?: string
  /** A deadline reminder email has been sent (cron, avoids repeats). */
  payment_reminded?: boolean
  /** Buyer change requests on a paid/approved ad. */
  change_requests?: Array<{ message: string; at: string }>
  // ── 2x1 (promoter-funnel-v2 S3 · US-3.3): pay 1 edition, appear in 2 ──────────
  /** Set at close time — this sale is a 2x1: pay 1 edition, appear in 2 consecutive. */
  is_2x1?: boolean
  /** Set on the ORIGINAL once its comped clone lands in the next edition. */
  is_2x1_cloned?: boolean
  /** The comped clone's submission id (on the ORIGINAL, once cloned). */
  is_2x1_clone_id?: string
  /** Set on the ORIGINAL when no eligible next edition exists yet — the admin-manual
   *  "clonar a la siguiente edición" fallback (v1, sprint-3.md build note). */
  is_2x1_needs_manual_clone?: boolean
  /** Set on the CLONE, pointing back to the original — excluded from commission
   *  (a clone is comped: it's never created by markAttributionPaid). */
  is_2x1_clone_of?: string
}

export interface PrintAdSubmission {
  id: string
  edition_id: string
  tier_key: PrintTierKey
  seller_id: string
  buyer_clerk_user_id: string | null
  buyer_email: string | null
  cart_id: string | null
  medusa_order_id: string | null
  medusa_product_id: string | null
  status: PrintSubmissionStatus
  content: PrintAdContent
  admin_notes: string | null
  created_at: string
  updated_at: string
}

/**
 * The slice of a submission the print-studio (zine) machine surface may read —
 * layout-relevant fields only. A `PRINT_STUDIO_TOKEN` bearer is a weaker
 * assurance than a Clerk admin session (no MFA, typically sits in a local
 * `.env`), so it must not receive buyer PII (email, Clerk id) or payment
 * details (SPEI CLABE/bank/phone) the full admin-console row carries.
 */
export interface PrintStudioSafeSubmission {
  id: string
  edition_id: string
  tier_key: PrintTierKey
  status: PrintSubmissionStatus
  content: Omit<PrintAdContent, 'manual_payment' | 'contact' | 'payment_reported' | 'payment_reported_at' | 'payment_reminded' | 'change_requests'>
  created_at: string
}

export function toStudioSafeSubmission(sub: PrintAdSubmission): PrintStudioSafeSubmission {
  const {
    manual_payment: _manual_payment,
    contact: _contact,
    payment_reported: _payment_reported,
    payment_reported_at: _payment_reported_at,
    payment_reminded: _payment_reminded,
    change_requests: _change_requests,
    ...safeContent
  } = sub.content
  return {
    id: sub.id,
    edition_id: sub.edition_id,
    tier_key: sub.tier_key,
    status: sub.status,
    content: safeContent,
    created_at: sub.created_at,
  }
}

/** Central WhatsApp surfaced on every ad (Miyagi concierge line). */
export const MIYAGI_CENTRAL_WHATSAPP =
  process.env.NEXT_PUBLIC_MIYAGI_WHATSAPP ?? ''

// ── Social / editorial section ─────────────────────────────────────────────

export type PrintSocialType = 'recomendacion' | 'reconocimiento' | 'evento' | 'saludo' | 'otro'
export type PrintSocialStatus = 'submitted' | 'approved' | 'placed' | 'rejected'

export const PRINT_SOCIAL_TYPES: { key: PrintSocialType; label: string }[] = [
  { key: 'recomendacion',  label: 'Recomendación' },
  { key: 'reconocimiento', label: 'Reconocimiento' },
  { key: 'evento',         label: 'Evento' },
  { key: 'saludo',         label: 'Saludo' },
  { key: 'otro',           label: 'Otro' },
]

export interface PrintSocialSubmission {
  id: string
  edition_id: string | null
  submitter_clerk_user_id: string | null
  submitter_name: string | null
  submitter_email: string | null
  type: PrintSocialType
  caption: string
  body: string | null
  photos: string[]
  zone: string | null
  /** Explicit moderator opt-in for the online Neighborhood Pulse feed. Missing/null reads as false. */
  web_visible?: boolean | null
  status: PrintSocialStatus
  source: 'community' | 'editor'
  admin_notes: string | null
  created_at: string
  updated_at: string
}
