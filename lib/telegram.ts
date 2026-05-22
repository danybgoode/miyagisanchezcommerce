/**
 * Telegram admin notifications.
 * Messages go to Daniel's private chat (@Don_Dany).
 * All functions are fire-and-forget — never throw, never block.
 *
 * Env vars required:
 *   TELEGRAM_BOT_TOKEN   — bot token from @BotFather
 *   TELEGRAM_CHAT_ID     — admin's personal chat ID
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID

// ── Core send ──────────────────────────────────────────────────────────────────

export async function tgNotify(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return   // silently skip if not configured

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(5000),  // 5s timeout — never block request path
    })
  } catch {
    // Intentionally swallowed — Telegram is observability, not critical path
  }
}

// ── Typed event helpers ────────────────────────────────────────────────────────

export const tg = {
  /** New seller account claimed (shop went from pending → active) */
  newShop(shopName: string, location: string | null, slug: string) {
    return tgNotify(`🏪 <b>Nueva tienda reclamada</b>\n<b>${esc(shopName)}</b>${location ? ` · ${esc(location)}` : ''}\nmiyagisanchez.com/s/${esc(slug)}`)
  },

  /** New listing published by a claimed seller */
  newListing(title: string, priceFmt: string, shopName: string, listingId: string) {
    return tgNotify(`📦 <b>Nuevo anuncio</b>\n${esc(title)} — <b>${esc(priceFmt)}</b>\nVendedor: ${esc(shopName)}\nmiyagisanchez.com/l/${esc(listingId)}`)
  },

  /** Sale completed via Stripe */
  salePaid(amount: string, title: string, buyerEmail: string, method: 'stripe' | 'mercadopago') {
    const icon = method === 'stripe' ? '💳' : '🟦'
    return tgNotify(`${icon} <b>Venta completada</b>\n<b>${esc(amount)}</b> — ${esc(title)}\nComprador: ${esc(buyerEmail)}`)
  },

  /** New subscription started */
  newSubscription(amount: string, interval: string, listingTitle: string, buyerEmail: string) {
    return tgNotify(`🔔 <b>Nueva suscripción</b>\n${esc(listingTitle)}\n<b>${esc(amount)}/${esc(interval)}</b> · ${esc(buyerEmail)}`)
  },

  /** Offer made on a listing */
  offerMade(offerAmount: string, listPrice: string, title: string, buyerEmail: string) {
    return tgNotify(`🤝 <b>Nueva oferta</b>\n${esc(title)}\n${esc(offerAmount)} (precio: ${esc(listPrice)}) · ${esc(buyerEmail)}`)
  },

  /** Offer accepted by seller */
  offerAccepted(amount: string, title: string) {
    return tgNotify(`✅ <b>Oferta aceptada</b>\n${esc(title)} · ${esc(amount)}`)
  },

  /** New user signed up (Clerk webhook) */
  newUser(email: string, name: string) {
    return tgNotify(`👤 <b>Nuevo usuario</b>\n${esc(name)} · ${esc(email)}`)
  },

  /** UCP webhook delivery failed all retries */
  webhookFailed(shopName: string, orderId: string, url: string) {
    return tgNotify(`⚠️ <b>Webhook fallido</b>\n${esc(shopName)} · Orden ${esc(orderId)}\nURL: <code>${esc(url)}</code>`)
  },

  /** Listing cleanup cron completed */
  cleanupRun(expired: number, deleted: number, stagingCleaned: number) {
    if (expired === 0 && deleted === 0 && stagingCleaned === 0) return Promise.resolve()
    return tgNotify(`🧹 <b>Limpieza de listings</b>\nExpirados: ${expired} · Eliminados: ${deleted} · Staging: ${stagingCleaned}`)
  },

  /** Generic admin alert */
  alert(message: string) {
    return tgNotify(`🚨 <b>Admin alert</b>\n${esc(message)}`)
  },
}

// ── HTML escape ────────────────────────────────────────────────────────────────

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
