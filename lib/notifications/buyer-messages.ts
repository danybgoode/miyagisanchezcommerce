import type { NotifyEvent } from '@/lib/notify'

/**
 * Centralized buyer push + Telegram copy (epic #5b · Sprint 2), es-MX.
 *
 * Pure + next-free (only a `type` import from `lib/notify`, erased at compile) so
 * the Playwright runner can unit-test copy completeness — the GROUP_COPY pattern
 * from #5. One source the `dispatchToBuyer` call-sites read and the spec checks,
 * so the per-event copy can't drift from what the seam sends. The email bodies
 * keep living in `lib/email.ts`; this module is only the push + Telegram surfaces.
 */

/** Buyer events that deliver push + Telegram in Sprint 2 (Compras → Sprint 3). */
export type BuyerMessageKind =
  | 'order_shipped'
  | 'order_delivered'
  | 'offer_accepted'
  | 'offer_countered'
  | 'offer_declined'
  | 'return_requested'
  | 'return_accepted'
  | 'return_declined'
  | 'refund_transfer_sent'

export const BUYER_MESSAGE_KINDS: readonly BuyerMessageKind[] = [
  'order_shipped',
  'order_delivered',
  'offer_accepted',
  'offer_countered',
  'offer_declined',
  'return_requested',
  'return_accepted',
  'return_declined',
  'refund_transfer_sent',
] as const

export type BuyerMessageParams = {
  /** Listing/product title (user-controlled → HTML-escaped in the Telegram body). */
  listingTitle: string
  /** The relevant in-app link (order detail / conversation / listing). */
  url: string
  /** Formatted refund amount (e.g. "$250") — return_accepted only. */
  refundAmount?: string
  /** Whether a return refund is partial — return_accepted only. */
  isPartial?: boolean
}

export type BuiltBuyerMessage = { push: NotifyEvent; telegram: string }

/** Minimal HTML escape for the Telegram parse_mode=HTML body (dynamic fields). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build the push + Telegram payloads for a buyer event. The email body is NOT
 * here (it stays in lib/email.ts); the caller passes this object's `push` and
 * `telegram` to `dispatchToBuyer`, which gates each by the buyer's prefs.
 */
export function buildBuyerMessage(kind: BuyerMessageKind, p: BuyerMessageParams): BuiltBuyerMessage {
  const t = escapeHtml(p.listingTitle)
  switch (kind) {
    case 'order_shipped':
      return {
        push: { kind: 'order', title: 'Tu pedido va en camino 📦', body: p.listingTitle, url: p.url },
        telegram: `📦 <b>Tu pedido va en camino</b>\n${t}\nSigue tu envío en Miyagi Sánchez.`,
      }
    case 'order_delivered':
      return {
        push: { kind: 'order', title: 'Tu pedido fue entregado ✅', body: p.listingTitle, url: p.url },
        telegram: `✅ <b>Tu pedido fue entregado</b>\n${t}\n¡Gracias por tu compra!`,
      }
    case 'offer_accepted':
      return {
        push: { kind: 'offer', title: '¡Oferta aceptada! 🎉', body: `Completa tu compra de "${p.listingTitle}"`, url: p.url },
        telegram: `🎉 <b>¡Tu oferta fue aceptada!</b>\n${t}\nCompleta tu compra en Miyagi Sánchez.`,
      }
    case 'offer_countered':
      return {
        push: { kind: 'offer', title: 'Tienes una contraoferta', body: p.listingTitle, url: p.url },
        telegram: `↔️ <b>Tienes una contraoferta</b>\n${t}\nRevísala y responde en Miyagi Sánchez.`,
      }
    case 'offer_declined':
      return {
        push: { kind: 'offer', title: 'Oferta rechazada', body: `Tu oferta por "${p.listingTitle}" fue rechazada`, url: p.url },
        telegram: `🚫 <b>Tu oferta fue rechazada</b>\n${t}\nPuedes hacer otra oferta cuando quieras.`,
      }
    case 'return_requested':
      return {
        push: { kind: 'order', title: 'Recibimos tu solicitud de devolución', body: p.listingTitle, url: p.url },
        telegram: `↩️ <b>Recibimos tu solicitud de devolución</b>\n${t}\nTe avisaremos cuando el vendedor responda.`,
      }
    case 'return_accepted':
      return {
        push: {
          kind: 'order',
          title: p.isPartial ? 'Reembolso parcial aprobado' : 'Devolución aceptada',
          body: p.refundAmount ? `${p.listingTitle} — ${p.refundAmount}` : p.listingTitle,
          url: p.url,
        },
        telegram:
          `✅ <b>${p.isPartial ? 'Reembolso parcial aprobado' : 'Devolución aceptada'}</b>\n${t}` +
          (p.refundAmount ? `\nReembolso: ${escapeHtml(p.refundAmount)}` : ''),
      }
    case 'return_declined':
      return {
        push: { kind: 'order', title: 'Devolución rechazada', body: p.listingTitle, url: p.url },
        telegram: `🚫 <b>Tu solicitud de devolución fue rechazada</b>\n${t}\nRevisa los detalles en Miyagi Sánchez.`,
      }
    case 'refund_transfer_sent':
      // Off-platform (SPEI/cash) rail: the seller marked the transfer as sent. The buyer
      // must confirm receipt to close the refund (lib/refund-state.ts → confirmado).
      return {
        push: {
          kind: 'order',
          title: 'El vendedor envió tu reembolso 💸',
          body: p.refundAmount ? `${p.listingTitle} — ${p.refundAmount}. Confirma cuando lo recibas.` : `${p.listingTitle}. Confirma cuando lo recibas.`,
          url: p.url,
        },
        telegram:
          `💸 <b>El vendedor envió tu reembolso</b>\n${t}` +
          (p.refundAmount ? `\nReembolso: ${escapeHtml(p.refundAmount)}` : '') +
          `\nConfírmalo cuando lo recibas en Miyagi Sánchez.`,
      }
  }
}
