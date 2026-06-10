/**
 * Shared types for the shop-settings surface.
 *
 * Derived from the shapes that already exist — the persisted client-prop shape
 * (`ShopSettingsData`) and the importer's patch body (`ShopPatchBody`) — so every
 * extracted section reads ONE source of truth instead of re-declaring the tree
 * inline. These are **type-only** re-exports (erased at compile), so this module
 * carries no runtime code and stays next-free + unit-testable by the Playwright
 * `api` runner.
 */

import type { ShopSettingsData } from '@/app/shop/manage/settings/ShopSettings'

export type { ShopSettingsData, ShopStripe, PickupSpot } from '@/app/shop/manage/settings/ShopSettings'
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
