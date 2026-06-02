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

/** Central WhatsApp surfaced on every ad (Miyagi concierge line). */
export const MIYAGI_CENTRAL_WHATSAPP =
  process.env.NEXT_PUBLIC_MIYAGI_WHATSAPP ?? ''
