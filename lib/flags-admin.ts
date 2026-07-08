/**
 * lib/flags-admin.ts
 *
 * The PURE half of the admin flag-control surface (epic 09 · feature-flags-inhouse,
 * Sprint 2). Kept free of `next/*`, `server-only`, and the Supabase client — like its
 * sibling `lib/flags-cache.ts` — so the write route's key/body validation is unit-
 * testable in the Playwright `api` runner with zero network (`e2e/flags-admin.spec.ts`).
 *
 * It carries the DISPLAY metadata the serving reader deliberately omits: `lib/flags.ts`
 * reads only `key, enabled` (the fail-open decision needs nothing more), but the admin
 * page must show every flag's polarity + fail-open default and must render a flag even
 * when its `platform_flags` row is ABSENT (an absent row ⇒ `isEnabled()` falls open to
 * DEFAULT_FLAGS, so the admin view unions the known keys with the DB rows).
 *
 * Drift guard: `FLAG_META` is typed `Record<FlagKey, FlagMeta>`, so adding a key to
 * `lib/flags.ts` (or removing one) without updating this map fails `tsc` — the known-key
 * set here can never silently diverge from the seam. The `FlagKey` import is TYPE-ONLY,
 * erased at runtime, so this module stays server-free and importable by the api runner.
 */
import type { FlagKey } from './flags'

/**
 * Both fail-open polarities (doc-only, mirrors the `platform_flags.polarity` column):
 *  - `killswitch` → default ON  (the feature keeps working if the store is down; the
 *    deliberate act is disabling — e.g. `checkout.stripe_enabled`, `pdp_redesign`).
 *  - `enablement` → default OFF (the gate stays off if the store is down; the
 *    deliberate act is enabling — e.g. `subdomain.paywall_enabled`).
 */
export type FlagPolarity = 'killswitch' | 'enablement'

export interface FlagMeta {
  /** Fail-open polarity (informational — shown in the admin table). */
  polarity: FlagPolarity
  /** The value `isEnabled()` returns when the row is absent (= DEFAULT_FLAGS). */
  default: boolean
}

/**
 * Known-flag metadata SSOT for the admin surface. Values mirror `DEFAULT_FLAGS` in
 * `lib/flags.ts` and the seed in `supabase/migrations/20260701120000_platform_flags.sql`
 * (kill-switch ⇒ default true; enablement ⇒ default false). Typed against `FlagKey` so
 * it can never drift from the seam (see the file header).
 */
export const FLAG_META: Record<FlagKey, FlagMeta> = {
  'checkout.stripe_enabled': { polarity: 'killswitch', default: true },
  // Rental booking charged as nights × rate + deposit (rental-backend-line-item-pricing
  // S1, backend rail already merged). Enablement: default OFF ⇒ today's coordination
  // flow (the backend 422s a rental checkout). Flip ON after S2–S3 + the money smoke.
  'checkout.rental_pricing_enabled': { polarity: 'enablement', default: false },
  'pdp_redesign': { polarity: 'killswitch', default: true },
  'domain.paywall_enabled': { polarity: 'enablement', default: false },
  'events.quantity_enabled': { polarity: 'enablement', default: false },
  'shipping.envia_enabled': { polarity: 'enablement', default: false },
  'promoter.enabled': { polarity: 'enablement', default: false },
  'ml.connect_enabled': { polarity: 'enablement', default: false },
  'ml.import_enabled': { polarity: 'enablement', default: false },
  'ml.publish_enabled': { polarity: 'enablement', default: false },
  // Two-way ML stock sync (epic 03 S4). Fail-CLOSED by function but seeds OFF; its real
  // enforcement lives in the backend + a per-seller enable, so the platform default is OFF.
  'ml.sync_enabled': { polarity: 'killswitch', default: false },
  // ML-sync paid/promoter-SKU entitlement gate (epic 03 S5). Enablement: default OFF ⇒
  // no paywall (any connected seller may enable sync); flip ON to start charging.
  'ml.sync_paywall_enabled': { polarity: 'enablement', default: false },
  // Materialize a paid ML sale as a real Medusa order (epic ml-orders-native S1).
  // Enablement: default OFF ⇒ today's behavior (stock sync only, no order) — a flag
  // outage can never start creating orders unsupervised. Real enforcement lives in the
  // BACKEND (webhook + reconcile job); flip ON once Daniel's live ML-sandbox
  // order-materialization smoke passes.
  'ml.orders_enabled': { polarity: 'enablement', default: false },
  'subdomain.paywall_enabled': { polarity: 'enablement', default: false },
  // Personal MCP URL + Claude one-click (epic 03 · seller-agent-connect-mcp-url S2) —
  // a NEW auth path to seller-scoped MCP tools. Enablement: default OFF ⇒ the URL
  // route 404s and the panel shows only the existing Bearer-token flow.
  'seller_agent.connector_url_enabled': { polarity: 'enablement', default: false },
  // Net-remittance (SPEI/DiMo/CoDi) promoter close (epic 08 · promoter-funnel-v2 S4).
  // Enablement: default OFF ⇒ the close checkout only ever offers Stripe.
  'promoter.transfer_enabled': { polarity: 'enablement', default: false },
  // Print-configurator artwork/custom-fields addition (custom-print-products
  // S3.4) — NOT the underlying variant/tier buy box (Sprint 2, unaffected).
  // Kill-switch: default ON, matching `pdp_redesign`'s polarity — OFF
  // reverts a configurator listing to Sprint 2's buy box with no artwork
  // field, never all the way back to a broken pre-Sprint-2 checkout.
  'configurator.enabled': { polarity: 'killswitch', default: true },
  // Seller profit/margins dashboard + the backend financial-events ledger
  // (epic 03 · profit-analyzer S1). Enablement: default OFF ⇒ the profit page
  // 404s and the ledger writes are no-ops; append-only + the backfill route
  // mean a late flip loses nothing. Flip ON after Daniel's margin smoke.
  'ops.profit_enabled': { polarity: 'enablement', default: false },
  // Bookshop launchpad — writer submission portal + review queue + campaigns
  // (epic 03 · bookshop-launchpad). Enablement: default OFF ⇒ /s/[slug]/convocatoria
  // + every /api/launchpad route 404s/rejects, and the seller Convocatoria surface
  // is hidden. Flip ON after Daniel's Sprint 1 guest submit→approve→publish→buy smoke.
  'launchpad.enabled': { polarity: 'enablement', default: false },
}

/** Every flag key the platform knows about (order = display order on `/admin/flags`). */
export const FLAG_KEYS = Object.keys(FLAG_META) as FlagKey[]

/** Narrow an untrusted value to a known `FlagKey`. */
export function isKnownFlagKey(key: unknown): key is FlagKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(FLAG_META, key)
}

/** Parsed, validated flag-write body — a discriminated result (never throws). */
export type FlagWriteParse =
  | { ok: true; key: FlagKey; enabled: boolean }
  | { ok: false; error: string }

/**
 * Validate the `POST /api/admin/flags` body. Rejects (Spanish `error`) an unknown flag
 * key or a non-boolean `enabled` — so a malformed body or a stray agent call can never
 * upsert a garbage row (which `resolveFlag`'s `typeof === 'boolean'` guard would then
 * fail OPEN over, masking the write). This is a MUTATION on a money-adjacent surface, so
 * it rejects rather than coerces (per LEARNINGS: coerce a purchase, reject a mutation).
 */
export function parseFlagWriteBody(body: unknown): FlagWriteParse {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Cuerpo inválido.' }
  }
  const { key, enabled } = body as { key?: unknown; enabled?: unknown }
  if (!isKnownFlagKey(key)) {
    return { ok: false, error: 'Flag desconocida.' }
  }
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: 'El valor "enabled" debe ser booleano.' }
  }
  return { ok: true, key, enabled }
}
