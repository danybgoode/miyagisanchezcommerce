/**
 * Promoter Funnel v2 · Sprint 5 (US-5.5) — the merchant close-receipt content
 * builder. Next-free + dependency-free (no supabase, no `next/*`) so it's
 * directly unit-testable (e2e/promoter-close-receipt.spec.ts); the actual
 * HTML/send lives in lib/email.ts#sendMerchantCloseReceipt.
 *
 * One receipt per completed SKU close (not batched per promoter visit) — see
 * the six completion call sites this feeds. When the promoter didn't capture
 * a merchant email at setup, the receipt falls back to the promoter's own
 * inbox with copy adapted to "share this with your merchant" instead of
 * "here's your receipt".
 */

export interface CloseReceiptItem {
  label: string
  /** Formatted MXN amount, or null for a $0/free item (rendered as "GRATIS"). */
  amountMxn: string | null
  note?: string
}

export interface CloseReceiptInput {
  shopName: string
  items: CloseReceiptItem[]
  claimUrl: string
  /** true when addressed to the merchant's own captured email; false = promoter fallback. */
  toMerchantDirectly: boolean
}

export interface CloseReceiptContent {
  subject: string
  intro: string
  items: CloseReceiptItem[]
  claimUrl: string
}

export function buildMerchantCloseReceipt(input: CloseReceiptInput): CloseReceiptContent {
  const shopName = input.shopName.trim() || 'tu tienda'
  const subject = `Recibo de ${shopName} en Miyagi Sánchez`
  const intro = input.toMerchantDirectly
    ? `Gracias por unirte a Miyagi Sánchez. Esto es lo que activamos para <strong>${shopName}</strong>:`
    : `Esto es lo que se activó para <strong>${shopName}</strong> — compártelo con tu comerciante:`
  return { subject, intro, items: input.items, claimUrl: input.claimUrl }
}
