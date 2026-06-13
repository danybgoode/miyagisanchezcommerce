import { type OfferStatus, formatOfferAmount } from './offers'

/**
 * Homepage Polish — Dirección B · Sprint 4: the signed-in pending-offer alert's
 * "is-actionable / max 2 / buyer-vs-seller" logic, kept in a next-free seam so a
 * pure-logic Playwright `api` spec (`e2e/home-offer-alert.spec.ts`) proves the rules
 * without auth/network. The homepage (`app/page.tsx`) does the Supabase reads and
 * feeds plain rows into `deriveOfferAlerts` — this module never imports `next/*` or
 * the db client.
 */

export type OfferPerspective = 'buyer' | 'seller'

/** The minimal offer fields the alert logic reads — the page maps its rows onto this. */
export interface OfferAlertInput {
  offerId: string
  conversationId: string | null
  perspective: OfferPerspective
  status: OfferStatus
  /** The pending deadline (`expires_at`): a pending offer past it is no longer actionable. */
  expiresAt: string
  amountCents: number
  currency: string
  listingTitle: string
  /** The shop the listing belongs to — shown to the buyer, omitted for the seller's own shop. */
  shopName: string | null
}

export interface OfferAlert {
  offerId: string
  perspective: OfferPerspective
  /** Bold lead line (es-MX). */
  title: string
  /** Muted listing (+ shop, buyer-side) line. */
  subtitle: string
  /** Deep-link to the offer thread (its conversation), else the right inbox. */
  href: string
  icon: string
  /** The deadline this alert counts against — also the sort key (soonest first). */
  deadlineIso: string
}

/** At most this many alert cards render on the homepage. */
export const MAX_OFFER_ALERTS = 2

function pastDeadline(iso: string, now: number): boolean {
  return new Date(iso).getTime() < now
}

/**
 * Actionable = a live pending offer that still needs attention: status `pending`
 * and not past its `expires_at`. Buyer-side it's their live offer awaiting the
 * seller ("sigue pendiente"); seller-side it's an offer awaiting their response
 * ("por responder"). Terminal (accepted/declined/countered/paid/withdrawn/expired)
 * or past-deadline offers never alert.
 */
export function isActionable(input: OfferAlertInput, now: number): boolean {
  if (input.status !== 'pending') return false
  return !pastDeadline(input.expiresAt, now)
}

function buildAlert(input: OfferAlertInput): OfferAlert {
  const amount = formatOfferAmount(input.amountCents, input.currency)
  const title =
    input.perspective === 'buyer'
      ? `Tu oferta de ${amount} sigue pendiente`
      : `Tienes una oferta de ${amount} por responder`
  const subtitle =
    input.perspective === 'buyer' && input.shopName
      ? `${input.listingTitle} · ${input.shopName}`
      : input.listingTitle
  const href = input.conversationId
    ? `/messages/${input.conversationId}`
    : input.perspective === 'seller'
      ? '/shop/manage/offers'
      : '/account'
  return {
    offerId: input.offerId,
    perspective: input.perspective,
    title,
    subtitle,
    href,
    icon: 'iconoir-hand-cash',
    deadlineIso: input.expiresAt,
  }
}

/**
 * The actionable alerts to render: filter to {@link isActionable}, sort
 * soonest-deadline first (most urgent), cap at {@link MAX_OFFER_ALERTS}.
 * Returns `[]` when nothing is actionable (the page then renders no alert).
 */
export function deriveOfferAlerts(inputs: OfferAlertInput[], now = Date.now()): OfferAlert[] {
  return inputs
    .filter(i => isActionable(i, now))
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())
    .slice(0, MAX_OFFER_ALERTS)
    .map(buildAlert)
}
