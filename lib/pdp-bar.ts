/**
 * lib/pdp-bar.ts
 *
 * PDP redesign (epic 01) — Sprint 1, S1.1 + S1.3.
 *
 * The pure, next-free seam that decides what the product page's action region
 * (the mobile sticky bar AND the desktop inline block) shows. It returns exactly
 * ONE mode — so the bar can never stack an offer-status banner on top of the buy
 * buttons (the reported overlap/stacking bug), and there is always one clear
 * primary action. No JSX, no network, no `next/*` import → unit-testable in the
 * Playwright `api` gate (`e2e/pdp-bar.spec.ts`).
 *
 * The component (`app/l/[id]/page.tsx`) renders the block for the returned mode;
 * this module owns only the *decision*, so the "one state at a time" invariant is
 * spec-provable and can't drift.
 */

import type { ActiveDealStatus } from '@/lib/active-deal'

/**
 * The single dominant state of the PDP action region.
 *  - `offer_accepted`   — buyer has an accepted-unpaid offer → agreed price + pay.
 *  - `offer_pending`    — buyer's offer is awaiting the seller → status only.
 *  - `offer_countered`  — seller countered → status + respond-in-messages.
 *  - `print_placement`  — print-ad listing → funnel to the ad builder, no checkout.
 *  - `buy`              — the default two-action set (Comprar primary · Hacer oferta).
 *  - `hidden`           — no action region renders (own listing, digital/sub, no
 *                         price, unclaimed, or sold out — `showBuyButtons` is false).
 */
export type PdpBarMode =
  | 'offer_accepted'
  | 'offer_pending'
  | 'offer_countered'
  | 'print_placement'
  | 'buy'
  | 'hidden'

export interface PdpBarInput {
  /** The existing `showBuyButtons` gate (claimed · not own · buyable price · in stock · physical/service). */
  showBuyButtons: boolean
  /** Print-ad placement → bought through the ad builder, never the generic checkout. */
  isPrintPlacement: boolean
  /** The buyer's active offer state on this listing, if any (`lib/active-deal.ts`). */
  activeDealStatus: ActiveDealStatus | null
}

/**
 * Decide the single mode the action region renders. Pure — same input, same output.
 * Total over the input: every case returns exactly one mode (never two stacked).
 */
export function derivePdpBarMode(input: PdpBarInput): PdpBarMode {
  if (!input.showBuyButtons) return 'hidden'
  if (input.isPrintPlacement) return 'print_placement'
  switch (input.activeDealStatus) {
    case 'accepted_unpaid':
      return 'offer_accepted'
    case 'pending':
      return 'offer_pending'
    case 'countered':
      return 'offer_countered'
    // 'none' | 'paid' | 'expired' | null → nothing in flight, offer the buy path.
    default:
      return 'buy'
  }
}

/**
 * Does this mode present a primary *purchase* action (a dominant "pay/buy" CTA)?
 * Only `buy` (Comprar ahora) and `offer_accepted` (pay the agreed price) do. The
 * pending/countered offer states deliberately show NO buy button (the offer is in
 * flight) — this is the S1.3 "one clear primary action" invariant, spec-checked.
 */
export function barHasPrimaryPurchase(mode: PdpBarMode): boolean {
  return mode === 'buy' || mode === 'offer_accepted'
}
