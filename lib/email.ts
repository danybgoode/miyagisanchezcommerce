/**
 * Centralized email — Miniflux-style templates.
 * Text-first. No decorative elements. Every line earns its place.
 */

import { Resend } from 'resend'

const FROM = 'Miyagi Sánchez <noreply@miyagisanchez.com>'
const SITE = 'https://miyagisanchez.com'

// ── Resend client (lazy) ──────────────────────────────────────────────────────

let _resend: Resend | null = null
function resend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('Missing RESEND_API_KEY')
    _resend = new Resend(key)
  }
  return _resend
}

// ── Seller email lookup via Clerk Management API ──────────────────────────────

export async function getSellerEmail(clerkUserId: string): Promise<string | null> {
  try {
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const user = await client.users.getUser(clerkUserId)
    return user.emailAddresses[0]?.emailAddress ?? null
  } catch {
    return null
  }
}

// ── Base template ─────────────────────────────────────────────────────────────
//
// Aesthetic: Miniflux / Hacker News / Pinboard
//   – no hero, no logo image, no gradient
//   – wordmark as plain text link, thin green rule beneath
//   – data laid out in key/value rows
//   – one CTA, sharp-ish corners, accent green
//   – footer is 2 lines of plain text

function html(subject: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f7">
<div style="max-width:500px;margin:0 auto;padding:36px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.65;color:#1a1a18">

  <!-- Wordmark -->
  <div style="padding-bottom:14px;margin-bottom:24px;border-bottom:2px solid #1d6f42">
    <a href="${SITE}" style="text-decoration:none;color:#1a1a18;font-weight:700;font-size:14px;letter-spacing:-0.2px">miyagisanchez.com</a>
  </div>

  ${body}

  <!-- Footer -->
  <div style="margin-top:36px;padding-top:14px;border-top:1px solid #e2e2de;font-size:12px;color:#6b6b67;line-height:1.5">
    Este correo fue enviado por actividad en tu cuenta.<br>
    <a href="${SITE}" style="color:#1d6f42;text-decoration:none">miyagisanchez.com</a> · sin comisiones, sin intermediarios.
  </div>

</div>
</body>
</html>`
}

// ── Template building blocks ──────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 18px;font-size:17px;font-weight:700;color:#1a1a18;letter-spacing:-0.2px">${esc(text)}</h1>`
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;color:#1a1a18">${text}</p>`
}

/** Key/value table — listing context, amounts, buyer info */
function table(rows: [string, string][]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:13px">
    ${rows.map(([k, v]) => `
    <tr>
      <td style="padding:5px 12px 5px 0;color:#6b6b67;white-space:nowrap;vertical-align:top;width:130px">${esc(k)}</td>
      <td style="padding:5px 0;color:#1a1a18;font-weight:500">${v}</td>
    </tr>`).join('')}
  </table>`
}

/** Big money amount with optional sub-label */
function amount(money: string, label: string, accent = false): string {
  return `<div style="margin:0 0 20px;padding:14px 16px;background:#f0f0ec;border-left:3px solid ${accent ? '#1d6f42' : '#e2e2de'}">
    <div style="font-size:22px;font-weight:700;color:${accent ? '#1d6f42' : '#1a1a18'};letter-spacing:-0.5px">${esc(money)}</div>
    <div style="font-size:12px;color:#6b6b67;margin-top:3px">${esc(label)}</div>
  </div>`
}

/** Buyer message / seller counter note — italicised blockquote */
function quote(text: string): string {
  return `<div style="margin:0 0 18px;padding:10px 14px;border-left:3px solid #e2e2de;color:#6b6b67;font-style:italic;font-size:13px">&ldquo;${esc(text)}&rdquo;</div>`
}

/** Inline notice (warning or neutral) */
function notice(text: string, type: 'warn' | 'info' = 'info'): string {
  const bg    = type === 'warn' ? '#fffbeb' : '#f0f0ec'
  const left  = type === 'warn' ? '#f59e0b' : '#1d6f42'
  const color = type === 'warn' ? '#92400e' : '#1a1a18'
  return `<div style="margin:0 0 18px;padding:10px 14px;background:${bg};border-left:3px solid ${left};font-size:13px;color:${color}">${text}</div>`
}

/** Single CTA button */
function cta(label: string, href: string): string {
  return `<div style="margin:22px 0">
    <a href="${href}" style="display:inline-block;background:#1d6f42;color:#ffffff;text-decoration:none;padding:10px 20px;font-size:13px;font-weight:600;border-radius:4px">${esc(label)} →</a>
  </div>`
}

function divider(): string {
  return `<div style="border-top:1px solid #e2e2de;margin:20px 0"></div>`
}

// ── Send helper ───────────────────────────────────────────────────────────────
// Returns the Resend email ID, or null when skipped/failed.
// Pass `scheduledAt` to defer delivery; Resend requires at least 15 min in future.

const RESEND_MIN_SCHEDULE_MS = 16 * 60 * 1000 // 16 min buffer

async function send(
  to: string,
  subject: string,
  body: string,
  scheduledAt?: Date,
): Promise<string | null> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping:', subject, '→', to)
    return null
  }
  if (scheduledAt && scheduledAt.getTime() - Date.now() < RESEND_MIN_SCHEDULE_MS) {
    // Too close to fire — just skip rather than error (window already passed)
    console.warn('[email] scheduled send too soon, skipping:', subject)
    return null
  }
  try {
    const result = await resend().emails.send({
      from: FROM,
      to,
      subject,
      html: html(subject, body),
      ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
    })
    return result.data?.id ?? null
  } catch (err) {
    console.error('[email] send failed:', subject, '→', to, err)
    return null
  }
}

// ── Cancel a scheduled email by Resend ID ─────────────────────────────────────

export async function cancelScheduledEmail(emailId: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  try {
    await resend().emails.cancel(emailId)
  } catch (err) {
    console.error('[email] cancel failed:', emailId, err)
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// OFFER EMAILS
// ════════════════════════════════════════════════════════════════════════════════

export interface OfferEmailCtx {
  listingTitle: string
  listingId: string
  listingUrl: string
  askingPrice: string
  offerAmount: string
  offerPct: number   // e.g. 83 = 83% of asking
  buyerName: string
  buyerEmail: string
  buyerMessage?: string | null
  currency: string
  offerId: string
  expiresAt: string  // ISO
}

// ── 1. Buyer: confirmation of offer submitted ─────────────────────────────────
export async function sendOfferConfirmed(ctx: OfferEmailCtx): Promise<void> {
  const subject = `Oferta enviada — ${ctx.listingTitle}`
  const body = [
    h1('Tu oferta fue enviada'),
    table([
      ['Anuncio',   `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Precio lista', ctx.askingPrice],
    ]),
    amount(ctx.offerAmount, `Tu oferta · ${ctx.offerPct}% del precio`),
    p('El vendedor tiene <strong>48 horas</strong> para responder. Recibirás un correo cuando lo haga.'),
    cta('Ver anuncio', ctx.listingUrl),
    notice('Si el vendedor no responde en 48 horas, tu oferta expirará automáticamente y podrás intentarlo de nuevo.'),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── 2. Seller: new offer alert ────────────────────────────────────────────────
export async function sendNewOfferToSeller(ctx: OfferEmailCtx & { sellerEmail: string }): Promise<void> {
  const subject = `Nueva oferta de ${ctx.buyerName} — ${ctx.listingTitle}`
  const body = [
    h1('Nueva oferta recibida'),
    table([
      ['Anuncio',   `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Precio lista', ctx.askingPrice],
    ]),
    amount(ctx.offerAmount, `Oferta de ${ctx.buyerName} · ${ctx.offerPct}% del precio`, true),
    ctx.buyerMessage ? quote(ctx.buyerMessage) : '',
    table([
      ['Comprador', ctx.buyerName],
      ['Correo',    ctx.buyerEmail],
      ['Expira',    new Date(ctx.expiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })],
    ]),
    notice('Los compradores que esperan más de 2 horas compran en otro lugar. <strong>Responde rápido.</strong>', 'warn'),
    cta('Ver y responder', `${SITE}/shop/manage/offers`),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── 3. Buyer: offer accepted — payment link ───────────────────────────────────
export async function sendOfferAccepted(ctx: OfferEmailCtx & {
  checkoutUrl?: string | null
  checkoutExpiresAt?: string | null
  sellerPhone?: string | null
}): Promise<void> {
  const subject = `✓ Tu oferta fue aceptada — ${ctx.listingTitle}`
  const savings = ctx.askingPrice // we'll show % saved
  const expiryStr = ctx.checkoutExpiresAt
    ? new Date(ctx.checkoutExpiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
    : null

  const body = [
    h1(`¡Tu oferta fue aceptada!`),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.offerAmount, `Precio acordado (${100 - ctx.offerPct}% de descuento)`, true),
    ctx.checkoutUrl
      ? [
          p('Completa el pago para confirmar la compra. El vendedor recibirá el pago directamente.'),
          cta('Completar pago', ctx.checkoutUrl),
          expiryStr ? notice(`El enlace de pago expira el <strong>${expiryStr}</strong>. Después de esa fecha el trato queda cancelado.`, 'warn') : '',
        ].join('')
      : [
          p('El vendedor se pondrá en contacto para coordinar el pago y la entrega.'),
          ctx.sellerPhone ? p(`WhatsApp del vendedor: <strong>${ctx.sellerPhone}</strong>`) : '',
          cta('Ver anuncio', ctx.listingUrl),
        ].join(''),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── 4. Buyer: offer declined ──────────────────────────────────────────────────
export async function sendOfferDeclined(ctx: Pick<OfferEmailCtx,
  'listingTitle' | 'listingUrl' | 'askingPrice' | 'offerAmount' | 'buyerEmail' | 'buyerName'>
): Promise<void> {
  const subject = `Tu oferta no fue aceptada — ${ctx.listingTitle}`
  const body = [
    h1('El vendedor no pudo aceptar tu oferta'),
    table([
      ['Anuncio',    `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Tu oferta',  ctx.offerAmount],
      ['Precio lista', ctx.askingPrice],
    ]),
    p('El artículo sigue disponible. Puedes hacer una nueva oferta o comprarlo al precio de lista.'),
    cta('Ver anuncio', ctx.listingUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── 5. Buyer: seller countered ────────────────────────────────────────────────
export async function sendOfferCountered(ctx: OfferEmailCtx & {
  counterAmount: string
  counterPct: number
  counterMessage?: string | null
  counterExpiresAt: string
}): Promise<void> {
  const subject = `El vendedor contraoferta — ${ctx.listingTitle}`
  const expiryStr = new Date(ctx.counterExpiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
  const body = [
    h1('El vendedor hace una contraoferta'),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.counterAmount, `Contraoferta del vendedor · ${ctx.counterPct}% del precio`),
    table([
      ['Tu oferta',    ctx.offerAmount],
      ['Precio lista', ctx.askingPrice],
    ]),
    ctx.counterMessage ? quote(ctx.counterMessage) : '',
    notice(`Tienes hasta el <strong>${expiryStr}</strong> para aceptar o rechazar.`, 'warn'),
    cta('Ver contraoferta', ctx.listingUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── 6. Seller: counter accepted ───────────────────────────────────────────────
export async function sendCounterAccepted(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  counterAmount: string
  buyerName: string
  buyerEmail: string
}): Promise<void> {
  const subject = `✓ Contraoferta aceptada — ${ctx.listingTitle}`
  const body = [
    h1('El comprador aceptó tu contraoferta'),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.counterAmount, 'Precio acordado', true),
    table([
      ['Comprador', ctx.buyerName],
      ['Correo',    ctx.buyerEmail],
    ]),
    p('Se envió un enlace de pago al comprador. Te notificaremos cuando complete el pago.'),
    cta('Ver panel', `${SITE}/shop/manage/offers`),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── 7. Seller: counter declined / offer withdrawn ────────────────────────────
export async function sendCounterDeclined(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  offerAmount: string
  counterAmount: string
  buyerName: string
}): Promise<void> {
  const subject = `El comprador rechazó tu contraoferta — ${ctx.listingTitle}`
  const body = [
    h1('El comprador no aceptó la contraoferta'),
    table([
      ['Anuncio',       `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Oferta inicial', ctx.offerAmount],
      ['Tu contraoferta', ctx.counterAmount],
      ['Comprador',      ctx.buyerName],
    ]),
    p('El anuncio sigue activo y disponible para nuevas ofertas o compra directa.'),
    cta('Ver anuncio', ctx.listingUrl),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

export async function sendOfferWithdrawn(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  offerAmount: string
  buyerName: string
}): Promise<void> {
  const subject = `Oferta retirada — ${ctx.listingTitle}`
  const body = [
    h1('El comprador retiró su oferta'),
    table([
      ['Anuncio',  `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Oferta',   ctx.offerAmount],
      ['Comprador', ctx.buyerName],
    ]),
    p('No se requiere ninguna acción. El anuncio sigue activo.'),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// REMINDER EMAILS (cron-triggered)
// ════════════════════════════════════════════════════════════════════════════════

// ── Seller: 24h nudge ─────────────────────────────────────────────────────────
// Pass `scheduledAt` to defer delivery (returns Resend email ID for cancellation).
export async function sendSellerOfferReminder(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  offerAmount: string
  offerPct: number
  buyerName: string
  expiresAt: string
}, scheduledAt?: Date): Promise<string | null> {
  const expiryStr = new Date(ctx.expiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
  const subject = `Tienes una oferta sin responder — ${ctx.listingTitle}`
  const body = [
    h1('Una oferta espera tu respuesta'),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.offerAmount, `Oferta de ${ctx.buyerName} · ${ctx.offerPct}% del precio`),
    table([['Expira', expiryStr]]),
    notice('Cuanto más tardes en responder, más probable es que el comprador pierda el interés.', 'warn'),
    cta('Responder ahora', `${SITE}/shop/manage/offers`),
  ].join('')
  return send(ctx.sellerEmail, subject, body, scheduledAt)
}

// ── Seller: expiry warning (4h left) ─────────────────────────────────────────
export async function sendSellerExpiryWarning(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  offerAmount: string
  offerPct: number
  buyerName: string
  expiresAt: string
}, scheduledAt?: Date): Promise<string | null> {
  const subject = `Última oportunidad — oferta por expirar · ${ctx.listingTitle}`
  const body = [
    h1('Una oferta expira en menos de 4 horas'),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.offerAmount, `Oferta de ${ctx.buyerName} · ${ctx.offerPct}% del precio`),
    notice('Si no respondes antes de que expire, el comprador podrá hacer una nueva oferta o comprar en otro lugar.', 'warn'),
    cta('Responder ahora', `${SITE}/shop/manage/offers`),
  ].join('')
  return send(ctx.sellerEmail, subject, body, scheduledAt)
}

// ── Buyer: counter expiry warning (4h left) ──────────────────────────────────
export async function sendBuyerCounterExpiryWarning(ctx: {
  buyerEmail: string
  listingTitle: string
  listingUrl: string
  counterAmount: string
  expiresAt: string
}, scheduledAt?: Date): Promise<string | null> {
  const subject = `La contraoferta expira en 4 horas — ${ctx.listingTitle}`
  const expiryStr = new Date(ctx.expiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
  const body = [
    h1('La contraoferta del vendedor expira pronto'),
    table([
      ['Anuncio',      `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Contraoferta', ctx.counterAmount],
      ['Expira',       expiryStr],
    ]),
    notice('Si no respondes antes de esa hora, perderás la oportunidad de comprar al precio acordado.', 'warn'),
    cta('Ver contraoferta', ctx.listingUrl),
  ].join('')
  return send(ctx.buyerEmail, subject, body, scheduledAt)
}

// ── Buyer: payment link expiry warning (4h left) ─────────────────────────────
export async function sendBuyerPaymentExpiryWarning(ctx: {
  buyerEmail: string
  listingTitle: string
  checkoutUrl: string
  agreedAmount: string
  expiresAt: string
}, scheduledAt?: Date): Promise<string | null> {
  const subject = `Tu enlace de pago expira en 4 horas — ${ctx.listingTitle}`
  const expiryStr = new Date(ctx.expiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
  const body = [
    h1('Completa tu pago antes de que expire'),
    table([
      ['Anuncio', `<strong>${esc(ctx.listingTitle)}</strong>`],
      ['Acordado', ctx.agreedAmount],
      ['Expira',   expiryStr],
    ]),
    notice('Si no pagas antes de esa hora, el trato quedará cancelado y el vendedor podrá vender a otro comprador.', 'warn'),
    cta('Completar pago ahora', ctx.checkoutUrl),
  ].join('')
  return send(ctx.buyerEmail, subject, body, scheduledAt)
}

// ════════════════════════════════════════════════════════════════════════════════
// PURCHASE EMAILS
// ════════════════════════════════════════════════════════════════════════════════

export async function sendSaleCompletedToSeller(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  amountPaid: string
  buyerName: string | null
  buyerEmail: string | null
  isDigital: boolean
}): Promise<void> {
  const subject = `✓ Venta completada — ${ctx.listingTitle}`
  const body = [
    h1('Recibiste un pago'),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.amountPaid, 'Monto recibido', true),
    table([
      ...(ctx.buyerName  ? [['Comprador', ctx.buyerName]  as [string, string]] : []),
      ...(ctx.buyerEmail ? [['Correo',    ctx.buyerEmail] as [string, string]] : []),
    ]),
    ctx.isDigital
      ? p('El archivo fue enviado al comprador automáticamente.')
      : p('El comprador ha sido notificado. Coordina la entrega directamente.'),
    divider(),
    p('<span style="font-size:12px;color:#6b6b67">El pago aparecerá en tu cuenta Stripe en 2–7 días hábiles.</span>'),
    cta('Ver panel', `${SITE}/shop/manage`),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

export async function sendOrderConfirmedToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  listingUrl: string
  amountPaid: string
  shopName: string
  isDigital: boolean
  digitalDownloadUrl?: string | null
  digitalExpiresAt?: string | null
}): Promise<void> {
  const subject = ctx.isDigital ? `Tu descarga está lista — ${ctx.listingTitle}` : `Compra confirmada — ${ctx.listingTitle}`
  const greeting = ctx.buyerName ? `¡Gracias, ${ctx.buyerName}!` : '¡Gracias por tu compra!'
  const expiryStr = ctx.digitalExpiresAt
    ? new Date(ctx.digitalExpiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
    : null

  const body = [
    h1(greeting),
    table([
      ['Anuncio',   `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Vendedor',  ctx.shopName],
      ['Pagado',    ctx.amountPaid],
    ]),
    ctx.isDigital && ctx.digitalDownloadUrl
      ? [
          p('Tu archivo está listo para descargar.'),
          cta('Descargar ahora', ctx.digitalDownloadUrl),
          expiryStr ? notice(`El enlace expira el ${expiryStr}.`) : '',
        ].join('')
      : [
          p('Tu pago fue procesado. El vendedor se pondrá en contacto para coordinar la entrega.'),
          cta('Ver anuncio', ctx.listingUrl),
        ].join(''),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}
