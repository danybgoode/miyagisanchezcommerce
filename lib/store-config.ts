/**
 * Read-side projection of a shop's configuration for the seller-side MCP
 * `get_store_configuration` tool (Sprint 4 US-1).
 *
 * Rebuilds the Sprint-3 declarative manifest shape from what's persisted on the
 * shop, deliberately omitting everything secret or OAuth-bound: payment keys,
 * SPEI CLABE / bank details, Stripe/MercadoPago tokens, Cal.com API keys, and
 * the agent/webhook secrets. An agent gets back exactly the surface it is
 * allowed to patch (see lib/settings-import.ts · validateConfig) — nothing more.
 */

import { MANUAL_SECTIONS, CONFIG_BLOCKS, type StoreConfigManifest } from './settings-import'

export interface StoreConfigSnapshot {
  /** The declarative, agent-patchable config (mirrors StoreConfigManifest). */
  configuration: StoreConfigManifest
  /** Which declarative blocks currently hold data. */
  configured_blocks: string[]
  /** Sections a config file/patch can't grant — still need a manual step. */
  manual_sections: Array<{ key: string; label: string; why: string }>
}

type ShopProfile = {
  name?: string | null
  description?: string | null
  location?: string | null
  logo_url?: string | null
  metadata?: Record<string, unknown> | null
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** Split a stored "Ciudad, Estado" location string back into city/state. */
function splitLocation(location?: string | null): { city?: string; state?: string } {
  if (!location) return {}
  const parts = location.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 2) return { city: parts[0], state: parts.slice(1).join(', ') }
  if (parts.length === 1) return { state: parts[0] }
  return {}
}

export function buildStoreConfigSnapshot(shop: ShopProfile): StoreConfigSnapshot {
  const settings = obj(obj(shop.metadata)?.settings) ?? {}
  const theme = obj(settings.theme) ?? {}
  const social = obj(theme.social)
  const { city, state } = splitLocation(shop.location)

  const configuration: StoreConfigManifest = {}

  // ── profile (name/description/location live as columns; brand bits in theme) ──
  const profile: NonNullable<StoreConfigManifest['profile']> = {}
  if (shop.name) profile.name = shop.name
  if (shop.description) profile.description = shop.description
  if (state) profile.state = state
  if (city) profile.city = city
  if (typeof theme.tagline === 'string' && theme.tagline) profile.tagline = theme.tagline
  if (typeof theme.accent_color === 'string') profile.accent_color = theme.accent_color
  if (shop.logo_url) profile.logo_url = shop.logo_url
  if (typeof theme.banner_url === 'string' && theme.banner_url) profile.banner_url = theme.banner_url
  if (social) {
    const cleaned = Object.fromEntries(
      Object.entries(social).filter(([, v]) => typeof v === 'string' && v),
    ) as NonNullable<NonNullable<StoreConfigManifest['profile']>['social']>
    if (Object.keys(cleaned).length) profile.social = cleaned
  }
  if (Object.keys(profile).length) configuration.profile = profile

  // ── pass-through declarative blocks (already secret-free) ─────────────────────
  const shipping = obj(settings.shipping)
  if (shipping && Object.keys(shipping).length) configuration.shipping = shipping as StoreConfigManifest['shipping']
  const offers = obj(settings.offers)
  if (offers && Object.keys(offers).length) configuration.offers = offers as StoreConfigManifest['offers']
  const notifications = obj(settings.notifications)
  if (notifications && Object.keys(notifications).length) configuration.notifications = notifications as StoreConfigManifest['notifications']
  const orders = obj(settings.orders)
  if (orders && Object.keys(orders).length) configuration.orders = orders as StoreConfigManifest['orders']
  const returns = obj(settings.returns_policy)
  if (returns && Object.keys(returns).length) configuration.returns_policy = returns as StoreConfigManifest['returns_policy']
  const scheduling = obj(settings.scheduling)
  if (scheduling && Array.isArray(scheduling.links)) configuration.scheduling = scheduling as StoreConfigManifest['scheduling']

  const configured_blocks = CONFIG_BLOCKS
    .map((b) => b.key)
    .filter((k) => configuration[k] !== undefined)
    .map(String)

  return {
    configuration,
    configured_blocks,
    manual_sections: MANUAL_SECTIONS,
  }
}
