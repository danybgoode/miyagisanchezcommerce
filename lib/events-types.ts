import type { Locale } from '@/lib/dictionary'

export type MarketplaceEventStatus = 'active' | 'cancelled'
export type MarketplaceEventRegistrationStatus = 'pending' | 'registered' | 'cancelled'

export interface MarketplaceEvent {
  id: string
  shop_id: string
  medusa_seller_id: string
  slug: string
  status: MarketplaceEventStatus
  title: string
  description: string | null
  venue_name: string
  venue_address: string | null
  starts_at: string
  capacity: number | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface MarketplaceEventRegistration {
  id: string
  event_id: string
  name: string | null
  email: string
  email_hash: string
  locale: Locale
  status: MarketplaceEventRegistrationStatus
  verification_code_hash: string | null
  verification_expires_at: string | null
  verification_attempts: number
  verification_sent_at: string | null
  verified_at: string | null
  confirmation_sent_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MarketplaceEventStats {
  registrations: number
  capacity_remaining: number | null
  full: boolean
}
