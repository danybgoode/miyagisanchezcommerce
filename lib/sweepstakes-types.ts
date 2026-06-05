import type { Locale } from '@/lib/dictionary'

export type SweepstakesStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled'
export type SweepstakesTicketSource = 'free_entry' | 'purchase_bonus'

export interface SweepstakesCampaign {
  id: string
  shop_id: string
  medusa_seller_id: string
  slug: string
  status: SweepstakesStatus
  title_es: string | null
  title_en: string | null
  prize_description_es: string | null
  prize_description_en: string | null
  prize_image_url: string | null
  terms_es: string | null
  terms_en: string | null
  starts_at: string | null
  ends_at: string | null
  free_ticket_value: number
  purchase_bonus_enabled: boolean
  purchase_ticket_value: number
  organizer_name: string | null
  organizer_contact: string | null
  permit_reference: string | null
  compliance_attested_at: string | null
  compliance_attested_by: string | null
  winner_entry_id: string | null
  winner_ticket_id: string | null
  winner_masked_contact: string | null
  draw_completed_at: string | null
  draw_audit: Record<string, unknown>
  consolation_sent_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface SweepstakesEntry {
  id: string
  campaign_id: string
  name: string
  email: string
  email_hash: string
  locale: Locale
  verified_at: string
  created_at: string
  updated_at: string
}

export interface SweepstakesDraw {
  id: string
  campaign_id: string
  winning_ticket_id: string
  winning_entry_id: string
  ticket_count: number
  pool_hash: string
  random_nonce: string
  random_value: string
  algorithm_version: string
  created_at: string
}

export interface SweepstakesSettings {
  enabled: boolean
  disabled_reason: string | null
}

export interface SweepstakesStats {
  entries: number
  tickets: number
}
