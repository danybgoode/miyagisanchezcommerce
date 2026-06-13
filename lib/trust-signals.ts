/**
 * lib/trust-signals.ts
 *
 * Trust & Messaging Polish (#3c · Epic C) — Sprint 2, C.4.
 *
 * The pure, next-free **selector seam** behind the shared `<TrustSignals>` component
 * (`app/components/TrustSignals.tsx`). It decides *which* trust-signal groups render
 * for a given (channel, variant) — the single source of truth so the marketplace PDP,
 * the negotiation entry (C.5), and Epic D's white-label / embed renders all agree.
 *
 * No JSX, no network, no `next/*` import → unit-testable in the Playwright `api` gate.
 *
 * Contract handed to Epic D (cross-channel-trust-parity):
 *   - `channel` reuses `ChannelSource` from `lib/channel.ts` (the type the app already
 *     detects via `detectChannel()`), so Epic D passes it straight through — no parallel
 *     type to keep in sync. `trustChannelBucket()` collapses it to the 3 buckets trust
 *     actually cares about.
 *   - `variant`: `'full'` (the PDP block) | `'slim'` (the negotiation capsule).
 *
 * Parity-first (C.4): for now every channel shows the same signals (the marketplace PDP
 * must look identical). The `channel` input + `trustChannelBucket()` are the documented
 * hook Epic D flips to suppress / re-shape signals per channel — wiring lands there.
 */

import type { ChannelSource } from '@/lib/channel'

export type TrustVariant = 'full' | 'slim'

/** A single payment / fulfillment chip, as the PDP already builds them. */
export interface TrustMethod {
  icon: string
  label: string
  note: string
}

/** The trust buckets that actually change a render (platform vs off-platform vs embed). */
export type TrustChannelBucket = 'platform' | 'off_platform' | 'embed'

/**
 * Collapse the 5-value `ChannelSource` to the 3 buckets trust cares about.
 * `marketplace` + `api` → platform; `custom_domain` + `subdomain` → off_platform; `embed` → embed.
 */
export function trustChannelBucket(channel: ChannelSource = 'marketplace'): TrustChannelBucket {
  if (channel === 'custom_domain' || channel === 'subdomain') return 'off_platform'
  if (channel === 'embed') return 'embed'
  return 'platform'
}

export interface TrustSignalsInput {
  /** Where the listing is rendering. Default `marketplace`. */
  channel?: ChannelSource
  /** `full` = the PDP block; `slim` = the negotiation-entry capsule. Default `full`. */
  variant?: TrustVariant
  hasPayment: boolean
  hasFulfillment: boolean
  processingLabel: string | null
  returnsLabel: string | null
  /** Seller verification badge (`shop.verified`). */
  verified?: boolean
  /** Any online card rail (Stripe / Mercado Pago) ⇒ buyer payment protection. */
  paymentProtected?: boolean
}

export interface TrustSignalVisibility {
  showProcessingPill: boolean
  showReturnsPill: boolean
  showPaymentGrid: boolean
  showFulfillmentGrid: boolean
  showVerified: boolean
  showProtection: boolean
}

/**
 * Decide which trust-signal groups render. Pure — same input, same output.
 *
 * - `full`: the PDP block — order-info pills (processing + returns) + the payment /
 *   fulfillment method grids. Identity/verification lives in `<SellerTrustCard>`, so the
 *   full variant does not re-render it (avoids duplication / parity drift).
 * - `slim`: the negotiation capsule — verification · payment-protection · return window
 *   (the eligibility a buyer wants *before* submitting an offer; closes 05 finding-3).
 */
export function selectTrustSignals(input: TrustSignalsInput): TrustSignalVisibility {
  const variant = input.variant ?? 'full'

  if (variant === 'slim') {
    return {
      showProcessingPill: false,
      showReturnsPill: !!input.returnsLabel,
      showPaymentGrid: false,
      showFulfillmentGrid: false,
      showVerified: !!input.verified,
      showProtection: !!input.paymentProtected,
    }
  }

  // full
  return {
    showProcessingPill: !!input.processingLabel,
    showReturnsPill: !!input.returnsLabel,
    showPaymentGrid: input.hasPayment,
    showFulfillmentGrid: input.hasFulfillment,
    showVerified: false,
    showProtection: false,
  }
}

/**
 * Map a shop's stored returns-policy window to a positive es-MX label.
 * Only 7/14/30-day windows surface as a trust signal — "no returns" is never shown
 * (it's the implicit default; platform protection applies regardless). Mirrors the PDP.
 * Reusable by Epic D's per-surface trust-input derivation.
 */
const RETURNS_WINDOW_LABELS: Record<string, string> = { '7d': '7 días', '14d': '14 días', '30d': '30 días' }
export function returnsWindowLabel(window?: string | null): string | null {
  return window ? RETURNS_WINDOW_LABELS[window] ?? null : null
}

/** es-MX copy for the slim capsule chips. Single source so the spec + UI can't drift. */
export const TRUST_COPY = {
  verified: 'Vendedor verificado',
  protection: 'Pago protegido',
  returns: (label: string) => `Devoluciones ${label}`,
} as const
