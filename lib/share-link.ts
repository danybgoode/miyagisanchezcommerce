/**
 * lib/share-link.ts
 *
 * Pure "share to WhatsApp" link builder — extracted from components/SuccessCard.tsx
 * (Sprint 2) so the S8 Comparte share card (Sprint 3 · Story 3.2) reuses the exact
 * same implementation instead of a third hand-rolled `wa.me/?text=` builder.
 * Not to be confused with app/components/SellerTrustCard.tsx's `whatsappUrl` — that
 * one messages a SPECIFIC phone number (a buyer contacting a seller); this one is a
 * generic "share to anyone" link with no phone target.
 */
export function buildWhatsAppShareLink(shareTitle: string, shareUrl: string): string {
  const message = `${shareTitle}: ${shareUrl}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
