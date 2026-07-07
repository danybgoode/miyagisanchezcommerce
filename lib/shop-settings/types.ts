/**
 * Shared types for the shop-settings surface — the ONE source of truth for the
 * persisted client-prop shape (`ShopSettingsData`) and its sub-shapes.
 *
 * These were defined inline in the `ShopSettings.tsx` monolith and re-exported
 * here; Sprint 4 deleted that monolith, so the definitions now live here directly.
 * Every extracted section (`_sections/*`) and the `[section]` route read their
 * slices through this module — type-only (erased at compile), so it carries no
 * runtime code and stays next-free + unit-testable by the Playwright `api` runner.
 */

export interface ShopStripe {
  account_id?: string
  charges_enabled?: boolean
  onboarding_complete?: boolean
  enabled?: boolean
}

export interface PickupSpot {
  id: string
  name: string
  address: string
  hours?: string
  notes?: string
  scheduling_url?: string
}

export interface ShopSettingsData {
  name: string
  description: string
  location: string | null
  logo_url?: string | null
  mp_enabled: boolean
  ucp_webhook_url?: string | null
  ucp_webhook_secret?: string | null
  /** Whether an MCP agent token has already been provisioned (Sprint 4). */
  agent_token_set?: boolean
  // Federated commerce — own channel
  slug?: string
  custom_domain?: string | null
  custom_domain_verified?: boolean
  calcom_connected?: boolean
  calcom_username?: string | null
  calcom_event_type_title?: string | null
  calcom_booking_url?: string | null
  stripe?: ShopStripe
  mercadopago?: { connected?: boolean; enabled?: boolean; live_mode?: boolean }
  metadata: {
    settings?: {
      preset?: string
      checkout?: {
        escrow_mode?: 'off' | 'optional' | 'required'
        payment_methods?: string[]
        show_phone?: boolean
        phone?: string | null
        whatsapp_cta?: boolean
        show_email?: boolean
        contact_email?: string | null
        bank_transfer?: {
          enabled: boolean
          clabe?: string | null
          bank_name?: string | null
          account_holder?: string | null
        }
      }
      shipping?: {
        local_pickup?: boolean
        custom_rates?: boolean
        envia_enabled?: boolean
        allowed_carriers?: string[]
        rate_display?: 'recommended' | 'cheapest' | 'all'
        handling_fee_cents?: number
        package_defaults?: {
          weight_grams?: number
          length_cm?: number
          width_cm?: number
          height_cm?: number
        }
        pickup_spots?: PickupSpot[]
        origin_address?: {
          name?: string | null
          street?: string | null
          number?: string | null
          colonia?: string | null
          city?: string | null
          state?: string | null
          state_code?: string | null
          postal_code?: string | null
        }
      }
      notifications?: {
        email_new_view?: boolean
        email_new_message?: boolean
      }
      offers?: {
        min_buyer_trust_level?: 'unverified' | 'basic' | 'trusted' | 'verified' | 'elite'
        negotiation?: {
          enabled: boolean
          auto_accept_pct?: number
          auto_decline_pct?: number
          auto_counter_pct?: number
        }
      }
      scheduling?: {
        links?: Array<{ label: string; url: string }>
      }
      orders?: {
        processing_time?: string
        auto_accept?: boolean
        dispatch_window_days?: number
        auto_confirm_days?: number
      }
      returns_policy?: {
        window?: string
        conditions?: string
        shipping_paid_by?: 'buyer' | 'seller'
        custom_note?: string | null
      } | null
      bundles?: {
        enabled?: boolean
        tiers?: Array<{ min_items: number; percent_off: number }>
      }
      support?: {
        enabled?: boolean
        preset_amount_cents?: number[]
        custom_min_cents?: number
        custom_max_cents?: number
        currency?: string
        default_visibility?: 'public' | 'private'
        support_product_id?: string | null
      }
      ucp?: {
        webhook_url?: string
        webhook_secret?: string
      }
      theme?: {
        banner_url?: string | null
        accent_color?: string | null
        tagline?: string | null
        social?: {
          instagram?: string | null
          facebook?: string | null
          whatsapp?: string | null
          tiktok?: string | null
          twitter?: string | null
        }
      }
      /** Own-shop premium presentation (epic 07, Sprint 1) — announcement bar. */
      announcement?: {
        text: string
        link?: string | null
      } | null
      /**
       * Hero/featured section. `pinned_listing_ids` is shop-level settings
       * storing Medusa product ids — distinct from the marketplace-level
       * Selección curation, which flags individual products via
       * `metadata.featured` / `metadata.featured_rank` (`lib/home-curation.ts`).
       * The two never share a storage location or a field name.
       */
      hero?: {
        mode: 'listings' | 'promo'
        pinned_listing_ids?: string[]
        promo_image_url?: string | null
        promo_cta_text?: string | null
        promo_cta_link?: string | null
      } | null
      /**
       * Curated visual preset key (font pairing + surface tone), distinct from
       * the store-type `preset` above (checkout/shipping behavior). See
       * `lib/shop-settings/theme-presets.ts`.
       */
      theme_preset?: string | null
      /**
       * Bookshop launchpad (epic 03) — writer-submission opt-in. When
       * `accepts_manuscripts` is true the public `/s/[slug]/convocatoria` portal
       * opens (also gated globally by the `launchpad.enabled` flag). `guidelines`
       * is the shop's es-MX submission-guidelines text shown on that portal.
       */
      launchpad?: {
        accepts_manuscripts?: boolean
        guidelines?: string | null
      }
    }
  } | null
}

export type { ShopPatchBody } from '@/lib/settings-import'

/** The persisted `metadata.settings` tree — the canonical shape every section writes a slice of. */
export type SettingsTree = NonNullable<NonNullable<ShopSettingsData['metadata']>['settings']>

// ── Per-section slices (derived via indexed access — never re-declared) ───────
export type CheckoutSettings = NonNullable<SettingsTree['checkout']>
export type ShippingSettings = NonNullable<SettingsTree['shipping']>
export type OffersSettings = NonNullable<SettingsTree['offers']>
export type OrdersSettings = NonNullable<SettingsTree['orders']>
export type NotificationsSettings = NonNullable<SettingsTree['notifications']>
export type ThemeSettings = NonNullable<SettingsTree['theme']>
export type ReturnsPolicySettings = NonNullable<SettingsTree['returns_policy']>
export type AnnouncementSettings = NonNullable<SettingsTree['announcement']>
export type HeroSettings = NonNullable<SettingsTree['hero']>
