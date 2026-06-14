/**
 * lib/event-hero.ts
 *
 * PDP redesign (epic 01) — Sprint 5, S5.3 (events / boletos).
 *
 * Pure, next-free seam for the event PDP. A ticket buyer needs date / venue /
 * availability first, then a way to buy and (after paying) a scannable ticket.
 * The page leads with the event block (`readEventDetails`) and relabels the buy
 * CTA to "Comprar boleto" — a ticket is just a buyable product; the existing
 * checkout + the Stripe/MercadoPago webhooks issue the ticket on payment.
 *
 * VALIDATION (see sprint-5.md): the buyer's purchased-ticket QR is NOT cleanly
 * reachable from the PDP read — it lives on the buyer's order (the order page
 * already renders it via `ticketQrPath`), and buyer→order resolution is the
 * documented-fragile Medusa gap. So this surface **links** a buyer to their
 * ticket ("Ver mi boleto") rather than resolving + rendering the QR inline.
 * Aforo / ticket tiers / a quantity selector have no live source (capacity lives
 * in a separate RSVP system, not linked to listings) and are deferred — stated
 * in the PR. The purchase + the QR after payment are a money/auth path owed to
 * Daniel.
 *
 * No JSX / no network → unit-tested in the `api` gate (`e2e/event-hero.spec.ts`).
 */

/** Where a buyer finds their purchased ticket + its QR (the order surface). */
export const MY_TICKETS_HREF = '/account/orders'

export interface EventHeroModel {
  /** es-MX buy-CTA label for event listings ("Comprar boleto — $price"). */
  buyLabel: string
  /** es-MX signed-out buy-CTA label. */
  signInLabel: string
  /** Link to the buyer's order/ticket surface (which renders the QR). */
  myTicketsHref: string
}

export function eventHeroModel(): EventHeroModel {
  return {
    buyLabel: 'Comprar boleto',
    signInLabel: 'Inicia sesión para comprar boleto',
    myTicketsHref: MY_TICKETS_HREF,
  }
}
