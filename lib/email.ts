/**
 * Centralized email — Miniflux-style templates.
 * Text-first. No decorative elements. Every line earns its place.
 */

import { Resend } from 'resend'
import { getDictionary, type Locale } from '@/lib/dictionary'
import { ticketQrPath, type EventTicket } from '@/lib/event-ticket-state'
import { buildMerchantCloseReceipt, type CloseReceiptItem } from '@/lib/promoter-close-receipt'
import { isRenderableArtworkUrl, isImageLikeArtworkUrl } from '@/lib/personalization'

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

/** Brand shown in the email wordmark + footer. Defaults to the platform; an
 *  own-channel order brands to the seller's custom domain instead. */
type Brand = { url: string; label: string }
const DEFAULT_BRAND: Brand = { url: SITE, label: 'miyagisanchez.com' }

function html(subject: string, body: string, brand: Brand = DEFAULT_BRAND): string {
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
    <a href="${brand.url}" style="text-decoration:none;color:#1a1a18;font-weight:700;font-size:14px;letter-spacing:-0.2px">${esc(brand.label)}</a>
  </div>

  ${body}

  <!-- Footer -->
  <div style="margin-top:36px;padding-top:14px;border-top:1px solid #e2e2de;font-size:12px;color:#6b6b67;line-height:1.5">
    Este correo fue enviado por actividad en tu cuenta.<br>
    <a href="${brand.url}" style="color:#1d6f42;text-decoration:none">${esc(brand.label)}</a> · sin comisiones, sin intermediarios.
  </div>

</div>
</body>
</html>`
}

/** Build the email brand from an optional own-channel store domain. */
function brandFor(storeDomain?: string | null): Brand {
  return storeDomain ? { url: `https://${storeDomain}`, label: storeDomain } : DEFAULT_BRAND
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

/** Buyer personalization — shown in order emails so both sides have the spec. */
export type EmailPersonalization = Array<{ title?: string; fields: Array<{ label?: string; value?: string; type?: string }> }>

function personalizationBlock(blocks?: EmailPersonalization | null): string {
  const clean = (blocks ?? []).filter(b => (b.fields ?? []).some(f => (f.value ?? '').trim()))
  if (!clean.length) return ''
  const multi = clean.length > 1
  const sections = clean.map(b => {
    const rows = (b.fields ?? [])
      .filter(f => (f.value ?? '').trim())
      .map(f => {
        const value = f.value ?? ''
        // Only ever render a `file` value as a link/thumbnail when it looks
        // like a real URL our own upload route produced — never trust an
        // unchecked string into an `<a href>`/`<img src>` inside an email
        // (order-item metadata is technically buyer/API-writable via some
        // paths). See `isRenderableArtworkUrl` for what "looks like" means
        // and its documented residual risk.
        if (f.type === 'file' && isRenderableArtworkUrl(value)) {
          const href = esc(value)
          const thumb = isImageLikeArtworkUrl(value)
            ? `<br/><img src="${href}" alt="${esc(f.label ?? 'Arte')}" style="max-width:120px;border-radius:6px;margin-top:4px;display:block">`
            : ''
          return `<div style="margin:2px 0"><span style="color:#6b6b67">${esc(f.label ?? '')}:</span> <a href="${href}" style="color:#1d6f42;font-weight:600">Descargar original</a>${thumb}</div>`
        }
        return `<div style="margin:2px 0"><span style="color:#6b6b67">${esc(f.label ?? '')}:</span> <span style="font-weight:600;color:#1a1a18">${esc(value)}</span></div>`
      })
      .join('')
    const head = multi && b.title ? `<div style="font-weight:600;margin:0 0 3px;color:#1a1a18">${esc(b.title)}</div>` : ''
    return `<div style="margin:0 0 8px">${head}${rows}</div>`
  }).join('')
  return `<div style="margin:0 0 20px;padding:12px 14px;background:#f0f0ec;border-left:3px solid #1d6f42;font-size:13px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#1d6f42;margin:0 0 6px">Personalización</div>
    ${sections}
  </div>`
}

function eventTicketBlock(tickets?: EventTicket[] | null): string {
  const clean = (tickets ?? []).filter(ticket => ticket.token)
  if (!clean.length) return ''
  const rows = clean.map((ticket, index) => `
    <div style="margin:0 0 10px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#1d6f42;margin:0 0 4px">Boleto ${index + 1}</div>
      <code style="display:block;word-break:break-all;background:#ffffff;border:1px solid #e2e2de;border-radius:4px;padding:8px">${esc(ticket.token)}</code>
      <div style="margin-top:8px"><a href="${SITE}${ticketQrPath(ticket.token)}" style="color:#1d6f42;text-decoration:none;font-weight:600">Descargar QR →</a></div>
    </div>
  `).join('')
  return `<div style="margin:0 0 20px;padding:12px 14px;background:#f0f0ec;border-left:3px solid #1d6f42;font-size:13px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#1d6f42;margin:0 0 6px">Boleto de entrada</div>
    <div style="margin:0 0 8px;color:#6b6b67">El QR contiene este token único. Preséntalo en la puerta.</div>
    ${rows}
  </div>`
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
  brand?: Brand,
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
      html: html(subject, body, brand),
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
  conversationUrl?: string | null
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
    cta('Ver conversación', ctx.conversationUrl ?? ctx.listingUrl),
    notice('Si el vendedor no responde en 48 horas, tu oferta expirará automáticamente y podrás intentarlo de nuevo.'),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── Referral: reward earned ───────────────────────────────────────────────────
export async function sendReferralReward(to: string, code: string, amountLabel: string): Promise<void> {
  const subject = `¡Ganaste ${amountLabel} de crédito! 🎁`
  const body = [
    h1('Tu invitado hizo su primera compra'),
    p('Como agradecimiento, te regalamos crédito para tu próximo anuncio en la edición impresa.'),
    amount(amountLabel, `Cupón ${esc(code)}`, true),
    p(`Ingresa el código <strong>${esc(code)}</strong> al pagar tu anuncio impreso.`),
    cta('Crear un anuncio', `${SITE}/account/print-ads`),
    notice('El crédito tiene vigencia limitada — úsalo pronto.'),
  ].join('')
  await send(to, subject, body)
}

// ── Sweepstakes: email verification ─────────────────────────────────────────
export async function sendSweepstakesVerificationCode(ctx: {
  to: string
  code: string
  locale: Locale
  campaignTitle: string
  campaignUrl: string
}): Promise<void> {
  const ui = (await getDictionary(ctx.locale)).sweepstakes.email
  const body = [
    h1(ui.verificationTitle),
    p(ui.verificationIntro),
    amount(ctx.code, ui.verificationCode, true),
    table([[ui.campaign, `<a href="${ctx.campaignUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.campaignTitle)}</a>`]]),
    notice(ui.verificationExpiry),
  ].join('')
  await send(ctx.to, ui.verificationSubject, body)
}

// ── Sweepstakes: winner notification ────────────────────────────────────────
export async function sendSweepstakesWinner(ctx: {
  to: string
  locale: Locale
  campaignTitle: string
  campaignUrl: string
}): Promise<void> {
  const ui = (await getDictionary(ctx.locale)).sweepstakes.email
  const body = [
    h1(ui.winnerTitle),
    p(ui.winnerIntro),
    table([[ui.campaign, `<a href="${ctx.campaignUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.campaignTitle)}</a>`]]),
    cta(ui.claimPrize, ctx.campaignUrl),
  ].join('')
  await send(ctx.to, `${ui.winnerSubject} — ${ctx.campaignTitle}`, body)
}

// ── Sweepstakes: consolation broadcast ──────────────────────────────────────
export async function sendSweepstakesConsolation(ctx: {
  to: string
  locale: Locale
  campaignTitle: string
  campaignUrl: string
  message: string
  couponCode?: string | null
}): Promise<void> {
  const ui = (await getDictionary(ctx.locale)).sweepstakes.email
  const body = [
    h1(ui.consolationTitle),
    p(ui.consolationIntro),
    quote(ctx.message),
    ctx.couponCode ? amount(ctx.couponCode, ui.coupon, true) : '',
    table([[ui.campaign, `<a href="${ctx.campaignUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.campaignTitle)}</a>`]]),
    cta(ui.claimPrize, ctx.campaignUrl),
  ].join('')
  await send(ctx.to, `${ui.consolationSubject} — ${ctx.campaignTitle}`, body)
}

// ── Bookshop launchpad: writer submission emails (es-MX only) ───────────────
// The launchpad is not on the bilingual allow-list (AGENTS rule #5) — es-MX
// literal copy, same shape as the print-ad editorial emails.

/** Writer: the 6-char code that verifies their email before a manuscript lands. */
export async function sendLaunchpadVerificationCode(ctx: {
  to: string
  code: string
  shopName: string
}): Promise<void> {
  const body = [
    h1('Confirma tu correo'),
    p(`Estás por enviar tu manuscrito a ${esc(ctx.shopName)}. Ingresa este código para confirmar que este correo es tuyo:`),
    amount(ctx.code, 'Tu código', true),
    notice('El código vence en 15 minutos. Si no intentaste enviar un manuscrito, ignora este mensaje.'),
  ].join('')
  await send(ctx.to, `Tu código para enviar tu manuscrito — ${ctx.shopName}`, body)
}

/** Writer: a curation-state change on their submission (Story 1.2). es-MX. */
export async function sendLaunchpadStatusEmail(ctx: {
  to: string
  authorName: string
  title: string
  shopName: string
  status: 'submitted' | 'in_review' | 'approved' | 'rejected' | 'changes_requested'
  note?: string | null
}): Promise<void> {
  const work = esc(ctx.title)
  const shop = esc(ctx.shopName)

  const COPY: Record<typeof ctx.status, { subject: string; title: string; intro: string } | null> = {
    submitted: null, // no email on re-entry to submitted (the writer just acted)
    in_review: {
      subject: `📖 ${ctx.shopName} está leyendo tu manuscrito`,
      title: 'Tu manuscrito está en revisión',
      intro: `${shop} recibió «${work}» y ya lo está leyendo. Te avisaremos en cuanto haya novedades.`,
    },
    approved: {
      subject: `✅ ¡Aceptaron tu manuscrito! — ${ctx.title}`,
      title: '¡Tu manuscrito fue aceptado!',
      intro: `${shop} aceptó «${work}». Muy pronto lo publicarán como libro digital y te enviaremos el enlace.`,
    },
    changes_requested: {
      subject: `✏️ Tu manuscrito necesita ajustes — ${ctx.title}`,
      title: 'La librería te pide algunos ajustes',
      intro: `${shop} revisó «${work}» y hay algo que ajustar antes de continuar. Cuando lo tengas listo, vuelve a enviarlo desde la página de convocatoria.`,
    },
    rejected: {
      subject: `Sobre tu manuscrito — ${ctx.title}`,
      title: 'Gracias por enviar tu obra',
      intro: `${shop} revisó «${work}» y en esta ocasión no seguirá adelante con su publicación. Agradecemos que la hayas compartido y te deseamos mucho éxito.`,
    },
  }

  const copy = COPY[ctx.status]
  if (!copy) return

  const body = [
    h1(copy.title),
    p(`Hola ${esc(ctx.authorName)},`),
    p(copy.intro),
    ...(ctx.note ? [quote(ctx.note)] : []),
  ].join('')
  await send(ctx.to, copy.subject, body)
}

/** Writer: their work is now live for sale (Story 1.3), with the public URL. */
export async function sendLaunchpadPublishedEmail(ctx: {
  to: string
  authorName: string
  title: string
  shopName: string
  url: string
}): Promise<void> {
  const body = [
    h1('¡Tu obra ya está publicada! 🎉'),
    p(`Hola ${esc(ctx.authorName)},`),
    p(`${esc(ctx.shopName)} publicó «${esc(ctx.title)}». Ya está disponible para lectores y se entrega automáticamente al comprarla.`),
    cta('Ver tu obra publicada', ctx.url),
  ].join('')
  await send(ctx.to, `📚 Ya está publicado: ${ctx.title}`, body)
}

// ── Events: email verification + RSVP confirmation ──────────────────────────
function formatEventEmailDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'full',
    timeStyle: 'short',
  })
}

export async function sendEventVerificationCode(ctx: {
  to: string
  code: string
  locale: Locale
  eventTitle: string
  eventUrl: string
}): Promise<void> {
  const ui = (await getDictionary(ctx.locale)).events.email
  const body = [
    h1(ui.verificationTitle),
    p(ui.verificationIntro),
    amount(ctx.code, ui.verificationCode, true),
    table([[ui.event, `<a href="${ctx.eventUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.eventTitle)}</a>`]]),
    notice(ui.verificationExpiry),
  ].join('')
  await send(ctx.to, ui.verificationSubject, body)
}

export async function sendEventRegistrationConfirmation(ctx: {
  to: string
  locale: Locale
  eventTitle: string
  eventUrl: string
  ticketToken?: string | null
  ticketQrUrl?: string | null
  startsAt: string
  venueName: string
  venueAddress?: string | null
}): Promise<void> {
  const ui = (await getDictionary(ctx.locale)).events.email
  const venue = ctx.venueAddress ? `${esc(ctx.venueName)}<br>${esc(ctx.venueAddress)}` : esc(ctx.venueName)
  const body = [
    h1(ui.confirmationTitle),
    p(ui.confirmationIntro),
    table([
      [ui.event, `<a href="${ctx.eventUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.eventTitle)}</a>`],
      [ui.date, esc(formatEventEmailDate(ctx.startsAt, ctx.locale))],
      [ui.venue, venue],
      ...(ctx.ticketToken ? [[ui.ticketToken, `<code>${esc(ctx.ticketToken)}</code>`] as [string, string]] : []),
    ]),
    ctx.ticketQrUrl ? cta(ui.downloadTicketQr, ctx.ticketQrUrl) : '',
    cta(ui.viewEvent, ctx.eventUrl),
  ].join('')
  await send(ctx.to, `${ui.confirmationSubject} — ${ctx.eventTitle}`, body)
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
      ['Expira',    new Date(ctx.expiresAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })],
    ]),
    notice('Los compradores que esperan más de 2 horas compran en otro lugar. <strong>Responde rápido.</strong>', 'warn'),
    cta('Ver y responder', ctx.conversationUrl ?? `${SITE}/shop/manage/offers`),
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
          p('Completa el pago desde la conversación para confirmar la compra. El vendedor recibirá el pago directamente.'),
          cta('Comprar ahora', ctx.checkoutUrl),
          expiryStr ? notice(`El trato expira el <strong>${expiryStr}</strong>. Después de esa fecha queda cancelado.`, 'warn') : '',
        ].join('')
      : [
          p('El vendedor se pondrá en contacto para coordinar el pago y la entrega.'),
          ctx.sellerPhone ? p(`WhatsApp del vendedor: <strong>${ctx.sellerPhone}</strong>`) : '',
          cta('Ver conversación', ctx.conversationUrl ?? ctx.listingUrl),
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
    cta('Ver contraoferta', ctx.conversationUrl ?? ctx.listingUrl),
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
  conversationUrl?: string | null
}): Promise<void> {
  const subject = `✓ Contraoferta aceptada — ${ctx.listingTitle}`
  const body = [
    h1('El comprador aceptó tu contraoferta'),
    table([['Anuncio', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.counterAmount, 'Precio acordado', true),
    table([
      ['Comprador', ctx.buyerName],
    ]),
    p('El comprador ya puede completar el pago desde la conversación. Te notificaremos cuando lo haga.'),
    cta('Ver conversación', ctx.conversationUrl ?? `${SITE}/shop/manage/offers`),
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
  conversationUrl?: string | null
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
    cta('Ver contraoferta', ctx.conversationUrl ?? ctx.listingUrl),
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
  personalization?: EmailPersonalization | null
  eventTickets?: EventTicket[] | null
  /** Own-channel order → brand the email to the seller's custom domain. */
  storeDomain?: string | null
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
    personalizationBlock(ctx.personalization),
    eventTicketBlock(ctx.eventTickets),
    ctx.isDigital && ctx.digitalDownloadUrl
      ? [
          p('Tu archivo está listo para descargar.'),
          cta('Descargar ahora', ctx.digitalDownloadUrl),
          expiryStr ? notice(`El enlace expira el ${expiryStr}.`) : '',
        ].join('')
      : [
          p('Tu pago fue procesado. El vendedor está preparando tu pedido. Te avisaremos cuando se envíe.'),
          cta('Ver estado del pedido', `${SITE}/account/orders`),
        ].join(''),
  ].join('')
  await send(ctx.buyerEmail, subject, body, undefined, brandFor(ctx.storeDomain))
}

// ════════════════════════════════════════════════════════════════════════════════
// ORDER / SHIPPING EMAILS
// ════════════════════════════════════════════════════════════════════════════════

// ── Seller: new physical order alert ─────────────────────────────────────────

export async function sendNewOrderToSeller(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  amountPaid: string
  buyerName: string | null
  buyerEmail: string | null
  shippingAddress: Record<string, string> | null
  orderId: string
  orderUrl: string
  personalization?: EmailPersonalization | null
}): Promise<void> {
  const subject = `📦 Nuevo pedido — ${ctx.listingTitle}`
  const addrStr = ctx.shippingAddress
    ? [ctx.shippingAddress.line1, ctx.shippingAddress.line2, ctx.shippingAddress.city, ctx.shippingAddress.state, ctx.shippingAddress.postal_code]
        .filter(Boolean).join(', ')
    : null

  const body = [
    h1('Recibiste un pedido'),
    table([['Producto', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`]]),
    amount(ctx.amountPaid, 'Monto recibido (en camino a tu cuenta)', true),
    table([
      ...(ctx.buyerName  ? [['Comprador', ctx.buyerName]  as [string, string]] : []),
      ...(addrStr ? [['Dirección',  addrStr]              as [string, string]] : []),
    ]),
    personalizationBlock(ctx.personalization),
    notice('Envía en menos de 3 días hábiles para mantener una buena reputación. Los compradores que esperan más de 72 h cancelan con más frecuencia.', 'warn'),
    cta('Gestionar pedido', ctx.orderUrl),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── Seller: Mercado Libre order event (ml-orders-native S2 · US-5) ────────────
//
// One lean template for all four ML-order lifecycle events (new / shipped /
// delivered / cancelled) rather than four near-duplicates — copy is fully
// data-driven off `subject`/`headline`/`note`, which the caller (the backend's
// notify bridge) selects per event kind.

export async function sendMlOrderEventToSeller(ctx: {
  sellerEmail: string
  subject: string
  headline: string
  note: string
  orderUrl: string
}): Promise<void> {
  const body = [h1(ctx.headline), p(ctx.note), cta('Ver pedido', ctx.orderUrl)].join('')
  await send(ctx.sellerEmail, ctx.subject, body)
}

// ── Seller: buyer reported a manual payment ("Ya hice el pago") ───────────────
//
// The money-path keystone (Granular Notifications S3.1). Fires when a buyer taps
// "Ya hice el pago" on a manual (SPEI/cash/DiMo) order — the durable
// `buyer_reported_paid` event (#3b). The seller still confirms receipt to capture;
// this just gets them to verify fast. Copy uses #3b's "en verificación" vocabulary.

export async function sendBuyerReportedPaymentToSeller(ctx: {
  sellerEmail: string
  listingTitle: string
  buyerEmail: string | null
  orderUrl: string
}): Promise<void> {
  const subject = `💸 El comprador avisó que pagó — ${ctx.listingTitle}`
  const body = [
    h1('El comprador avisó que pagó'),
    table([
      ['Producto', `<a href="${ctx.orderUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ...(ctx.buyerEmail ? [['Comprador', esc(ctx.buyerEmail)] as [string, string]] : []),
    ]),
    p('El comprador marcó este pedido como pagado. Verifica que el depósito llegó a tu cuenta antes de confirmar el pago y preparar el envío.'),
    notice('Hasta que confirmes el pago, el pedido sigue como “Pago reportado — en verificación”.', 'warn'),
    cta('Verificar y confirmar', ctx.orderUrl),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── Buyer: order shipped notification ─────────────────────────────────────────

export async function sendOrderShipped(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  orderUrl: string
  carrier: string
  trackingNumber: string | null
  estimatedDelivery: string | null
  shopName: string
}): Promise<void> {
  const subject = `🚚 Tu pedido está en camino — ${ctx.listingTitle}`
  const greeting = ctx.buyerName ? `¡${ctx.buyerName}, tu pedido ya viene!` : '¡Tu pedido está en camino!'
  const deliveryStr = ctx.estimatedDelivery
    ? new Date(ctx.estimatedDelivery).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })
    : null

  const body = [
    h1(greeting),
    table([
      ['Producto', esc(ctx.listingTitle)],
      ['Vendedor', ctx.shopName],
      ['Paquetería', ctx.carrier],
      ...(ctx.trackingNumber ? [['Número de guía', `<span style="font-family:monospace">${esc(ctx.trackingNumber)}</span>`] as [string, string]] : []),
      ...(deliveryStr ? [['Entrega estimada', deliveryStr] as [string, string]] : []),
    ]),
    p('Recibirás tu paquete pronto. Puedes rastrear el estado de tu envío en tu historial de compras.'),
    cta('Ver estado del pedido', ctx.orderUrl),
    notice('Si no recibes tu paquete en la fecha estimada, contacta al vendedor desde tu historial de compras.'),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── Buyer: order delivered — request review ───────────────────────────────────

export async function sendOrderDelivered(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  orderUrl: string
  shopName: string
}): Promise<void> {
  const subject = `¡Tu pedido fue entregado! — ${ctx.listingTitle}`
  const greeting = ctx.buyerName ? `¡${ctx.buyerName}, esperamos que lo disfrutes!` : '¡Tu pedido fue entregado!'

  const body = [
    h1(greeting),
    table([
      ['Producto', esc(ctx.listingTitle)],
      ['Vendedor', ctx.shopName],
    ]),
    p('Tu pedido fue marcado como entregado. Si tienes algún problema con tu compra, contáctanos desde el detalle del pedido.'),
    cta('Ver pedido', ctx.orderUrl),
    notice('¿Todo bien? Confirmar la entrega le ayuda al vendedor a recibir su pago completo.'),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// RETURN REQUEST EMAILS

const REASON_LABELS: Record<string, string> = {
  not_as_described: 'No coincide con la descripción',
  damaged:          'Artículo dañado',
  wrong_item:       'Artículo incorrecto',
  changed_mind:     'Cambié de opinión',
  other:            'Otro motivo',
}

// ── Seller: new return request ────────────────────────────────────────────────

export async function sendReturnRequestToSeller(ctx: {
  sellerEmail: string
  shopName: string
  buyerName: string | null
  buyerEmail: string
  listingTitle: string
  reason: string
  description: string | null
  orderUrl: string
}): Promise<void> {
  const subject = `↩ Solicitud de devolución — ${ctx.listingTitle}`

  const body = [
    h1('Un comprador solicitó una devolución'),
    table([
      ['Producto',  esc(ctx.listingTitle)],
      ['Motivo',    esc(REASON_LABELS[ctx.reason] ?? ctx.reason)],
      ...(ctx.buyerName  ? [['Comprador', esc(ctx.buyerName)]  as [string, string]] : []),
    ]),
    ctx.description ? quote(ctx.description) : '',
    notice('Tienes 3 días hábiles para responder. Si no hay respuesta, el comprador puede escalar el caso.', 'warn'),
    cta('Gestionar solicitud', ctx.orderUrl),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── Buyer: return request received ───────────────────────────────────────────

export async function sendReturnRequestConfirmedToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  shopName: string
  orderUrl: string
}): Promise<void> {
  const subject = `Tu solicitud de devolución fue enviada — ${ctx.listingTitle}`
  const greeting = ctx.buyerName ? `${ctx.buyerName}, recibimos tu solicitud.` : 'Recibimos tu solicitud de devolución.'

  const body = [
    h1(greeting),
    table([
      ['Producto', esc(ctx.listingTitle)],
      ['Tienda',   esc(ctx.shopName)],
    ]),
    p('El vendedor tiene 3 días hábiles para responder. Te notificaremos cuando tome una decisión.'),
    cta('Ver estado de la solicitud', ctx.orderUrl),
    notice('Si no recibes respuesta en 3 días hábiles, contáctanos y lo resolveremos juntos.'),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── Buyer: return request accepted ───────────────────────────────────────────

export async function sendReturnAcceptedToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  shopName: string
  refundAmount: string
  isPartial: boolean
  sellerNote: string | null
  orderUrl: string
}): Promise<void> {
  const subject = ctx.isPartial
    ? `Reembolso parcial procesado — ${ctx.listingTitle}`
    : `✓ Devolución aceptada — ${ctx.listingTitle}`
  const greeting = ctx.isPartial
    ? 'El vendedor aprobó un reembolso parcial.'
    : '¡Tu devolución fue aceptada!'

  const body = [
    h1(greeting),
    table([
      ['Producto',  esc(ctx.listingTitle)],
      ['Vendedor',  esc(ctx.shopName)],
      ['Reembolso', esc(ctx.refundAmount)],
    ]),
    ctx.sellerNote ? [p('Nota del vendedor:'), quote(ctx.sellerNote)].join('') : '',
    p('El reembolso aparecerá en tu cuenta en 5–10 días hábiles dependiendo de tu banco.'),
    cta('Ver detalle del pedido', ctx.orderUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── Buyer: off-platform (SPEI/cash) refund transfer sent ─────────────────────
// The seller marked the transfer as sent. Honest copy — the money was sent by the
// seller off-platform (not a card refund), so the buyer must confirm receipt to
// close the refund (lib/refund-state.ts → confirmado). Delivery & Manual-Money S1.

export async function sendRefundTransferSentToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  shopName: string
  refundAmount: string | null
  sellerNote: string | null
  orderUrl: string
}): Promise<void> {
  const subject = `El vendedor envió tu reembolso — ${ctx.listingTitle}`

  const body = [
    h1('El vendedor envió tu reembolso 💸'),
    table([
      ['Producto',  esc(ctx.listingTitle)],
      ['Vendedor',  esc(ctx.shopName)],
      ...(ctx.refundAmount ? [['Reembolso', esc(ctx.refundAmount)] as [string, string]] : []),
    ]),
    ctx.sellerNote ? [p('Nota del vendedor:'), quote(ctx.sellerNote)].join('') : '',
    p('Revisa tu cuenta. Cuando confirmes que recibiste el reembolso, márcalo como recibido para cerrar la devolución.'),
    cta('Confirmar que recibí el reembolso', ctx.orderUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ── Buyer: return request declined ───────────────────────────────────────────

export async function sendReturnDeclinedToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  shopName: string
  sellerNote: string | null
  orderUrl: string
}): Promise<void> {
  const subject = `Tu solicitud de devolución fue rechazada — ${ctx.listingTitle}`

  const body = [
    h1('El vendedor rechazó tu solicitud de devoluci��n.'),
    table([
      ['Producto', esc(ctx.listingTitle)],
      ['Vendedor', esc(ctx.shopName)],
    ]),
    ctx.sellerNote ? [p('Motivo del vendedor:'), quote(ctx.sellerNote)].join('') : '',
    p('Si crees que esta decisión es incorrecta, puedes contactar al vendedor directamente para llegar a un acuerdo.'),
    cta('Ver detalle del pedido', ctx.orderUrl),
    notice('¿No quedó resuelto? Contáctanos y revisaremos el caso.', 'warn'),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// MANUAL DELIVERY EMAILS (coordinated & local pickup)
// ══════════��═════════════════════════════���═══════════════════════════════════════

// ── Coordinated delivery — Buyer ─────────────────────────────────────────────

export async function sendCoordinatedOrderToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  listingUrl: string
  amountPaid: string
  shopName: string
  sellerPhone?: string | null
  sellerWhatsapp?: string | null
  orderUrl: string
  personalization?: EmailPersonalization | null
  eventTickets?: EventTicket[] | null
  /** Own-channel order → brand the email to the seller's custom domain. */
  storeDomain?: string | null
}): Promise<void> {
  const greeting = ctx.buyerName ? `¡Gracias, ${ctx.buyerName}!` : '¡Gracias por tu compra!'
  const subject = `Compra confirmada — coordina la entrega con ${ctx.shopName}`

  const whatsappUrl = ctx.sellerWhatsapp
    ? `https://wa.me/${ctx.sellerWhatsapp.replace(/\D/g, '').replace(/^(?!52)/, '52')}?text=${encodeURIComponent(`Hola, acabo de comprar "${ctx.listingTitle}" en Miyagi Sánchez y quiero coordinar la entrega.`)}`
    : null

  const body = [
    h1(greeting),
    p('Tu pago fue procesado. El vendedor acordará contigo cómo y cuándo recibirás tu pedido — espera su mensaje o contáctalo directamente.'),
    table([
      ['Producto',  `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Vendedor',  esc(ctx.shopName)],
      ['Pagado',    esc(ctx.amountPaid)],
      ['Entrega',   'Por coordinar con el vendedor'],
      ...(ctx.sellerPhone ? [['Teléfono vendedor', esc(ctx.sellerPhone)] as [string, string]] : []),
    ]),
    personalizationBlock(ctx.personalization),
    eventTicketBlock(ctx.eventTickets),
    notice('El vendedor tiene hasta <strong>24 horas</strong> para contactarte. Guarda este correo como comprobante de tu compra.', 'info'),
    whatsappUrl
      ? cta('Contactar por WhatsApp', whatsappUrl)
      : cta('Ver estado del pedido', ctx.orderUrl),
    p(`Si en 24 horas no has tenido noticias, ve al <a href="${ctx.orderUrl}" style="color:#1d6f42">detalle de tu pedido</a> para escribirle al vendedor.`),
  ].join('')
  await send(ctx.buyerEmail, subject, body, undefined, brandFor(ctx.storeDomain))
}

// ── Coordinated delivery — Seller ───────��────────────────────────────────────

export async function sendCoordinatedOrderToSeller(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  amountPaid: string
  buyerName: string | null
  buyerEmail: string | null
  shopName: string
  orderId: string
  orderUrl: string
  personalization?: EmailPersonalization | null
}): Promise<void> {
  const subject = `📦 Nuevo pedido — acuerda la entrega con el comprador`

  const body = [
    h1('Tienes un nuevo pedido de entrega acordada'),
    table([
      ['Producto',   `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ...(ctx.buyerName  ? [['Comprador', esc(ctx.buyerName)]  as [string, string]] : []),
      ...(ctx.buyerEmail ? [['Email', `<a href="mailto:${esc(ctx.buyerEmail)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.buyerEmail)}</a>`] as [string, string]] : []),
    ]),
    personalizationBlock(ctx.personalization),
    amount(ctx.amountPaid, 'Monto recibido (en camino a tu cuenta)', true),
    notice('El comprador eligió <strong>entrega acordada</strong>. Tienes <strong>24 horas</strong> para contactarlo y definir cómo y cuándo le entregas el artículo.', 'warn'),
    cta('Gestionar pedido', ctx.orderUrl),
    divider(),
    p('<strong>¿Qué hacer?</strong><br>1. Contacta al comprador por correo o mensaje.<br>2. Acuerda el método de entrega (envío propio, paquetería, en mano).<br>3. Una vez entregado, marca el pedido como entregado desde tu panel.'),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── Local pickup — Buyer ─────────────────────────────────────────────────────

export async function sendPickupOrderToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  listingUrl: string
  amountPaid: string
  shopName: string
  pickupAddress?: string | null
  pickupInstructions?: string | null
  sellerPhone?: string | null
  sellerWhatsapp?: string | null
  orderUrl: string
  personalization?: EmailPersonalization | null
  eventTickets?: EventTicket[] | null
  /** Own-channel order → brand the email to the seller's custom domain. */
  storeDomain?: string | null
}): Promise<void> {
  const greeting = ctx.buyerName ? `¡Gracias, ${ctx.buyerName}!` : '¡Gracias por tu compra!'
  const subject = `Compra confirmada — recoge tu pedido en ${ctx.shopName}`

  const whatsappUrl = ctx.sellerWhatsapp
    ? `https://wa.me/${ctx.sellerWhatsapp.replace(/\D/g, '').replace(/^(?!52)/, '52')}?text=${encodeURIComponent(`Hola, compré "${ctx.listingTitle}" en Miyagi Sánchez y quiero coordinar la recolección.`)}`
    : null

  const body = [
    h1(greeting),
    p('Tu pago fue procesado. Este vendedor ofrece recolección en mano. El vendedor te confirmará el lugar y horario disponible.'),
    table([
      ['Producto',        `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Vendedor',        esc(ctx.shopName)],
      ['Pagado',          esc(ctx.amountPaid)],
      ['Entrega',         'Recolección en mano'],
      ...(ctx.pickupAddress      ? [['Ubicación',    esc(ctx.pickupAddress)]      as [string, string]] : []),
      ...(ctx.pickupInstructions ? [['Instrucciones', esc(ctx.pickupInstructions)] as [string, string]] : []),
      ...(ctx.sellerPhone        ? [['Teléfono',     esc(ctx.sellerPhone)]        as [string, string]] : []),
    ]),
    personalizationBlock(ctx.personalization),
    eventTicketBlock(ctx.eventTickets),
    notice('El vendedor confirmará el horario. Guarda este correo como comprobante de pago.', 'info'),
    whatsappUrl
      ? cta('Coordinar por WhatsApp', whatsappUrl)
      : cta('Ver estado del pedido', ctx.orderUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body, undefined, brandFor(ctx.storeDomain))
}

// ── Local pickup — Seller ────────────────────────────────────────────────────

export async function sendPickupOrderToSeller(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  amountPaid: string
  buyerName: string | null
  buyerEmail: string | null
  shopName: string
  orderUrl: string
  personalization?: EmailPersonalization | null
}): Promise<void> {
  const subject = `📦 Nuevo pedido — el comprador recogerá en mano`

  const body = [
    h1('Tienes un nuevo pedido de recolección'),
    table([
      ['Producto',   `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ...(ctx.buyerName  ? [['Comprador', esc(ctx.buyerName)]  as [string, string]] : []),
      ...(ctx.buyerEmail ? [['Email', `<a href="mailto:${esc(ctx.buyerEmail)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.buyerEmail)}</a>`] as [string, string]] : []),
    ]),
    personalizationBlock(ctx.personalization),
    amount(ctx.amountPaid, 'Monto recibido (en camino a tu cuenta)', true),
    notice('El comprador <strong>recogerá el artículo en mano</strong>. Contáctalo para confirmar el horario y lugar de recolección.', 'warn'),
    cta('Gestionar pedido', ctx.orderUrl),
    divider(),
    p('<strong>¿Qué hacer?</strong><br>1. Contáctalo para confirmar horario de recolección.<br>2. Ten el artículo listo el día acordado.<br>3. Una vez entregado en mano, marca el pedido como entregado desde tu panel.'),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ── Manual ("Pago directo") — pending payment ─────────────────────────────────

export type ManualPaymentSnapshot = {
  spei?: { clabe: string; bank_name?: string | null; account_holder?: string | null } | null
  dimo?: { phone: string } | null
  cash?: { note?: string | null } | null
}

/** Renders the seller's configured manual methods as email table rows. */
function manualInstructionRows(mp: ManualPaymentSnapshot): [string, string][] {
  const rows: [string, string][] = []
  if (mp.spei?.clabe) {
    const extra = [mp.spei.bank_name ? `Banco: ${esc(mp.spei.bank_name)}` : '', mp.spei.account_holder ? `Titular: ${esc(mp.spei.account_holder)}` : '']
      .filter(Boolean).join(' · ')
    rows.push(['SPEI', `CLABE <strong style="font-family:monospace">${esc(mp.spei.clabe)}</strong>${extra ? `<br><span style="color:#666">${extra}</span>` : ''}`])
  }
  if (mp.dimo?.phone) {
    rows.push(['DiMo', `Transfiere al teléfono <strong style="font-family:monospace">${esc(mp.dimo.phone)}</strong>`])
  }
  if (mp.cash) {
    rows.push(['Efectivo al recoger', esc(mp.cash.note || 'Paga en efectivo cuando recojas tu pedido.')])
  }
  return rows
}

export async function sendManualOrderToBuyer(ctx: {
  buyerEmail: string
  buyerName: string | null
  listingTitle: string
  listingUrl: string
  amountToPay: string
  shopName: string
  manualPayment: ManualPaymentSnapshot
  orderUrl: string
  personalization?: EmailPersonalization | null
}): Promise<void> {
  const greeting = ctx.buyerName ? `¡Gracias, ${ctx.buyerName}!` : '¡Gracias por tu compra!'
  const subject = `Pedido registrado — completa tu pago en ${ctx.shopName}`
  const rows = manualInstructionRows(ctx.manualPayment)

  const body = [
    h1(greeting),
    p('Tu pedido quedó <strong>reservado</strong>. Para completarlo, realiza tu pago con cualquiera de las opciones que acepta el vendedor:'),
    table([
      ['Producto', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ['Vendedor', esc(ctx.shopName)],
      ['Monto a pagar', esc(ctx.amountToPay)],
      ...rows,
    ]),
    personalizationBlock(ctx.personalization),
    notice('Una vez que el vendedor reciba tu pago, lo confirmará y procesará tu pedido. Guarda este correo.', 'info'),
    cta('Ver mi pedido', ctx.orderUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

export async function sendManualOrderToSeller(ctx: {
  sellerEmail: string
  listingTitle: string
  listingUrl: string
  amount: string
  buyerName: string | null
  buyerEmail: string | null
  shopName: string
  orderUrl: string
  personalization?: EmailPersonalization | null
}): Promise<void> {
  const subject = `📦 Nuevo pedido — pago directo pendiente`
  const body = [
    h1('Tienes un nuevo pedido'),
    table([
      ['Producto', `<a href="${ctx.listingUrl}" style="color:#1d6f42;text-decoration:none">${esc(ctx.listingTitle)}</a>`],
      ...(ctx.buyerName  ? [['Comprador', esc(ctx.buyerName)]  as [string, string]] : []),
      ...(ctx.buyerEmail ? [['Email', `<a href="mailto:${esc(ctx.buyerEmail)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.buyerEmail)}</a>`] as [string, string]] : []),
    ]),
    personalizationBlock(ctx.personalization),
    amount(ctx.amount, 'Monto del pedido', true),
    notice('El comprador pagará por <strong>pago directo</strong> (SPEI / DiMo / efectivo). Cuando recibas el pago, márcalo como confirmado en tu panel para procesar el pedido.', 'warn'),
    cta('Gestionar pedido', ctx.orderUrl),
  ].join('')
  await send(ctx.sellerEmail, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// PRINT EDITION EMAILS — "Sal en la edición impresa"
// ════════════════════════════════════════════════════════════════════════════════

function formatPrintDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Buyer (advertiser): receipt + what to expect after paying for a print placement. */
export async function sendPrintAdReceivedToBuyer(ctx: {
  buyerEmail: string
  buyerName?: string | null
  editionTitle: string
  providerName: string
  tierLabel: string
  amountPaid: string
  submissionDeadline?: string | null
  distributionDate?: string | null
  manageUrl: string
}): Promise<void> {
  const subject = `🗞️ Recibimos tu anuncio — ${ctx.editionTitle}`
  const deadline = formatPrintDate(ctx.submissionDeadline)
  const distrib = formatPrintDate(ctx.distributionDate)
  const body = [
    h1('¡Tu lugar en la edición impresa está apartado!'),
    p('Gracias. Recibimos los elementos de tu anuncio y nuestro equipo lo diseñará con la estética México 86 antes de imprimir.'),
    table([
      ['Edición', esc(ctx.editionTitle)],
      ['Imprenta', esc(ctx.providerName)],
      ['Tamaño', esc(ctx.tierLabel)],
      ...(deadline ? [['Cierre de edición', esc(deadline)] as [string, string]] : []),
      ...(distrib ? [['Distribución', esc(distrib)] as [string, string]] : []),
    ]),
    amount(ctx.amountPaid, 'Pago recibido', true),
    notice('Próximos pasos: <strong>Miyagi diseña tu anuncio</strong> → te compartimos una vista previa → se imprime y distribuye. Si necesitamos algo más, te escribimos.'),
    cta('Ver mis anuncios', ctx.manageUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

/** Miyagi (admin): a new paid placement landed in the editorial queue. */
export async function sendPrintAdReceivedToMiyagi(ctx: {
  adminEmail: string
  editionTitle: string
  tierLabel: string
  sellerName: string
  buyerEmail: string | null
  amountPaid: string
  ctaUrl: string | null
  photosCount: number
  adminUrl: string
}): Promise<void> {
  const subject = `🗞️ Nuevo anuncio pagado — ${ctx.editionTitle} (${ctx.tierLabel})`
  const body = [
    h1('Nuevo anuncio para la edición impresa'),
    table([
      ['Edición', esc(ctx.editionTitle)],
      ['Tamaño', esc(ctx.tierLabel)],
      ['Anunciante', esc(ctx.sellerName)],
      ...(ctx.buyerEmail ? [['Email', `<a href="mailto:${esc(ctx.buyerEmail)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.buyerEmail)}</a>`] as [string, string]] : []),
      ['Fotos', String(ctx.photosCount)],
      ...(ctx.ctaUrl ? [['Enlace QR', `<a href="${esc(ctx.ctaUrl)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.ctaUrl)}</a>`] as [string, string]] : []),
    ]),
    amount(ctx.amountPaid, 'Pagado', true),
    cta('Abrir cola editorial', ctx.adminUrl),
  ].join('')
  await send(ctx.adminEmail, subject, body)
}

interface PrintManualMethods {
  spei?: { clabe?: string | null; bank_name?: string | null; account_holder?: string | null } | null
  dimo?: { phone?: string | null } | null
  cash?: { note?: string | null } | null
}

/** Buyer: manual (SPEI/DiMo/cash) payment is pending — here's how to pay. */
export async function sendPrintAdPaymentPending(ctx: {
  buyerEmail: string
  buyerName?: string | null
  editionTitle: string
  tierLabel: string
  amountDue: string
  manual: PrintManualMethods
  submissionDeadline?: string | null
  manageUrl: string
}): Promise<void> {
  const subject = `🗞️ Aparta tu anuncio — falta el pago (${ctx.editionTitle})`
  const deadline = formatPrintDate(ctx.submissionDeadline)
  const rows: [string, string][] = [
    ['Edición', esc(ctx.editionTitle)],
    ['Tamaño', esc(ctx.tierLabel)],
    ...(deadline ? [['Pagar antes de', esc(deadline)] as [string, string]] : []),
  ]
  if (ctx.manual.spei?.clabe) {
    rows.push(['CLABE (SPEI)', `<strong>${esc(ctx.manual.spei.clabe)}</strong>`])
    if (ctx.manual.spei.bank_name) rows.push(['Banco', esc(ctx.manual.spei.bank_name)])
    if (ctx.manual.spei.account_holder) rows.push(['Titular', esc(ctx.manual.spei.account_holder)])
  }
  if (ctx.manual.dimo?.phone) rows.push(['DiMo (teléfono)', `<strong>${esc(ctx.manual.dimo.phone)}</strong>`])
  if (ctx.manual.cash?.note) rows.push(['Efectivo', esc(ctx.manual.cash.note)])

  const body = [
    h1('Tu lugar está apartado — falta el pago'),
    p('Reservamos tu espacio en la edición. Para confirmar tu anuncio, realiza el pago con los datos de abajo. En cuanto lo recibamos, lo verás reflejado y empezamos el diseño.'),
    amount(ctx.amountDue, 'Monto a pagar', true),
    table(rows),
    notice('Cuando hagas la transferencia, entra a "Mis anuncios" y toca <strong>"Ya hice el pago"</strong> para avisarnos y agilizar la confirmación.'),
    cta('Ver instrucciones y estado', ctx.manageUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

/** Buyer: ad approved by the editor — it's going in the edition. */
export async function sendPrintAdApproved(ctx: {
  buyerEmail: string
  buyerName?: string | null
  editionTitle: string
  tierLabel: string
  distributionDate?: string | null
  manageUrl: string
}): Promise<void> {
  const subject = `✅ Tu anuncio fue aprobado — ${ctx.editionTitle}`
  const distrib = formatPrintDate(ctx.distributionDate)
  const body = [
    h1('¡Tu anuncio quedó aprobado!'),
    p('Nuestro equipo revisó tu anuncio y lo incluiremos en la edición impresa. Ya puedes ver cómo quedará desde "Mis anuncios".'),
    table([
      ['Edición', esc(ctx.editionTitle)],
      ['Tamaño', esc(ctx.tierLabel)],
      ...(distrib ? [['Distribución', esc(distrib)] as [string, string]] : []),
    ]),
    cta('Ver mi anuncio', ctx.manageUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

/** Buyer: ad needs changes / was rejected — what to fix. */
export async function sendPrintAdRejected(ctx: {
  buyerEmail: string
  buyerName?: string | null
  editionTitle: string
  tierLabel: string
  reason?: string | null
  manageUrl: string
}): Promise<void> {
  const subject = `✏️ Tu anuncio necesita ajustes — ${ctx.editionTitle}`
  const body = [
    h1('Necesitamos algunos ajustes'),
    p('Revisamos tu anuncio y hay algo que ajustar antes de imprimirlo. Edítalo desde "Mis anuncios" y vuelve a enviarlo.'),
    ...(ctx.reason ? [quote(ctx.reason)] : []),
    table([
      ['Edición', esc(ctx.editionTitle)],
      ['Tamaño', esc(ctx.tierLabel)],
    ]),
    cta('Editar mi anuncio', ctx.manageUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

/** Admin: a buyer reports they've sent a manual payment — verify + confirm. */
export async function sendPrintPaymentReportedToMiyagi(ctx: {
  adminEmail: string
  editionTitle: string
  tierLabel: string
  buyerEmail: string | null
  amount?: string | null
  adminUrl: string
}): Promise<void> {
  const subject = `💸 Pago reportado — ${ctx.editionTitle} (${ctx.tierLabel})`
  const body = [
    h1('Un anunciante reporta su pago'),
    p('Verifica que el pago haya llegado y confírmalo en la cola editorial para liberar el diseño.'),
    table([
      ['Edición', esc(ctx.editionTitle)],
      ['Tamaño', esc(ctx.tierLabel)],
      ...(ctx.buyerEmail ? [['Anunciante', `<a href="mailto:${esc(ctx.buyerEmail)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.buyerEmail)}</a>`] as [string, string]] : []),
      ...(ctx.amount ? [['Monto', esc(ctx.amount)] as [string, string]] : []),
    ]),
    cta('Confirmar en la cola editorial', ctx.adminUrl),
  ].join('')
  await send(ctx.adminEmail, subject, body)
}

/** Buyer: acknowledgement that we received their payment notice. */
export async function sendPrintPaymentReportedToBuyer(ctx: {
  buyerEmail: string
  buyerName?: string | null
  editionTitle: string
  manageUrl: string
}): Promise<void> {
  const subject = `Recibimos tu aviso de pago — ${ctx.editionTitle}`
  const body = [
    h1('¡Gracias! Recibimos tu aviso'),
    p('Estamos verificando tu pago. En cuanto lo confirmemos, empezamos a diseñar tu anuncio y te avisamos. Normalmente toma poco tiempo.'),
    cta('Ver el estado de mi anuncio', ctx.manageUrl),
  ].join('')
  await send(ctx.buyerEmail, subject, body)
}

/** Submitter: confirmation that their community/social post was received. */
export async function sendPrintSocialReceived(ctx: {
  toEmail: string
  caption: string
  mineUrl: string
}): Promise<void> {
  const subject = '📣 Recibimos tu aporte para la edición impresa'
  const body = [
    h1('¡Gracias por compartir con tu colonia!'),
    p('Recibimos tu aporte. Nuestro equipo lo revisará y podría aparecer en la próxima edición impresa.'),
    quote(ctx.caption),
    cta('Ver mis aportes', ctx.mineUrl),
  ].join('')
  await send(ctx.toEmail, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// AGENT CONFIG ALERTS (Sprint 4 US-4)
// ════════════════════════════════════════════════════════════════════════════════

const AGENT_BLOCK_LABELS: Record<string, string> = {
  profile:        'Perfil y marca',
  shipping:       'Envíos y entrega',
  offers:         'Negociación y ofertas',
  notifications:  'Notificaciones',
  orders:         'Gestión de pedidos',
  returns_policy: 'Devoluciones',
  scheduling:     'Enlaces de agenda',
}

/** Security alert: a seller's MCP agent changed a sensitive config block. */
export async function sendAgentConfigAlert(ctx: {
  to: string
  shopName: string
  blocks: string[]
  sensitive: string[]
}): Promise<void> {
  const subject = `Tu agente cambió la configuración de ${ctx.shopName}`
  const label = (k: string) => AGENT_BLOCK_LABELS[k] ?? k
  const body = [
    h1('Un agente modificó tu tienda'),
    p(`Tu agente de IA aplicó cambios en la configuración de <strong>${esc(ctx.shopName)}</strong> a través de MCP.`),
    table(ctx.blocks.map((b) => [label(b), ctx.sensitive.includes(b) ? 'Modificado · sensible' : 'Modificado'])),
    notice('Si no reconoces este cambio, revisa y revoca el token de tu agente en Configuración → Agentes e integraciones.', 'warn'),
    cta('Revisar configuración', `${SITE}/shop/manage/settings/agentes`),
  ].join('')
  await send(ctx.to, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// PROMOTER APPLICATIONS (epic 08 · promoter-funnel-v2 · Sprint 2)
// ════════════════════════════════════════════════════════════════════════════════

/** Admin (Daniel): a new self-serve promoter application landed. */
export async function sendPromoterApplicationReceivedToAdmin(ctx: {
  adminEmail: string
  name: string
  email: string
  whatsapp: string
  city: string | null
  motivation: string | null
  adminUrl: string
}): Promise<void> {
  const subject = `📝 Nueva solicitud de promotor — ${ctx.name}`
  const body = [
    h1('Nueva solicitud de promotor'),
    table([
      ['Nombre', esc(ctx.name)],
      ['Email', `<a href="mailto:${esc(ctx.email)}" style="color:#1d6f42;text-decoration:none">${esc(ctx.email)}</a>`],
      ['WhatsApp', esc(ctx.whatsapp)],
      ...(ctx.city ? [['Ciudad/zona', esc(ctx.city)] as [string, string]] : []),
    ]),
    ctx.motivation ? quote(ctx.motivation) : '',
    cta('Revisar solicitudes', ctx.adminUrl),
  ].join('')
  await send(ctx.adminEmail, subject, body)
}

/** Applicant: approved — here's your PRM- code + how to finish signup. */
export async function sendPromoterApplicationApproved(ctx: {
  to: string
  name: string
  code: string
  bindUrl: string
}): Promise<void> {
  const subject = '✅ Ya eres promotor — aquí está tu código'
  const body = [
    h1(`¡Felicidades, ${esc(ctx.name)}!`),
    p('Tu solicitud para ser promotor de Miyagi Sánchez fue aprobada. Este es tu código personal:'),
    amount(ctx.code, 'Tu código de promotor', true),
    p('Para empezar a cerrar ventas:'),
    table([
      ['1', 'Crea tu cuenta en miyagisanchez.com (o inicia sesión si ya tienes una)'],
      ['2', 'Entra a tu panel de promotor y captura tu código'],
      ['3', 'Ábrelo y empieza a montar tiendas'],
    ]),
    cta('Ingresar mi código', ctx.bindUrl),
    notice('Guarda este correo — tu código es tuyo y personal, no lo compartas.'),
  ].join('')
  await send(ctx.to, subject, body)
}

/** Applicant: rejected — polite es-MX close. */
export async function sendPromoterApplicationRejected(ctx: {
  to: string
  name: string
}): Promise<void> {
  const subject = 'Tu solicitud de promotor'
  const body = [
    h1(`Gracias por tu interés, ${esc(ctx.name)}`),
    p('Revisamos tu solicitud para ser promotor de Miyagi Sánchez y, por ahora, no podemos avanzar con ella.'),
    p('Puedes volver a aplicar más adelante si tu situación cambia. Gracias por el interés en el proyecto.'),
  ].join('')
  await send(ctx.to, subject, body)
}

// ════════════════════════════════════════════════════════════════════════════════
// PROMOTER NET-REMITTANCE TRANSFERS (epic 08 · promoter-funnel-v2 · Sprint 4)
// ════════════════════════════════════════════════════════════════════════════════

/** Promoter: your reported transfer was approved — the benefit is already live. */
export async function sendPromoterTransferApproved(ctx: {
  to: string
  skuLabel: string
  owedMxn: string
}): Promise<void> {
  const subject = `✅ Transferencia aprobada — ${ctx.skuLabel} activado`
  const body = [
    h1('Transferencia aprobada'),
    p(`Confirmamos tu transferencia de ${esc(ctx.owedMxn)}. El beneficio ya está activo en la tienda del comerciante:`),
    amount(ctx.skuLabel, 'Producto activado', true),
  ].join('')
  await send(ctx.to, subject, body)
}

/** Promoter: your reported transfer was rejected — an es-MX reason + retry note. */
export async function sendPromoterTransferRejected(ctx: {
  to: string
  skuLabel: string
  reason: string | null
}): Promise<void> {
  const subject = 'Tu transferencia no pudo confirmarse'
  const body = [
    h1('Transferencia rechazada'),
    p(`No pudimos confirmar tu transferencia para ${esc(ctx.skuLabel)}.`),
    ctx.reason ? quote(ctx.reason) : '',
    p('Puedes intentar de nuevo desde el flujo de cierre.'),
  ].join('')
  await send(ctx.to, subject, body)
}

/**
 * Promoter Funnel v2 · Sprint 5 (US-5.5) — the branded merchant receipt after a
 * promoter close: what they bought, what they paid, what happens next, plus
 * the claim-link recap. Fired from every close-completion path (see
 * lib/promoter-close-receipt.ts's header comment for the six call sites) —
 * one email per completed SKU close, not batched per promoter visit.
 */
export async function sendMerchantCloseReceipt(ctx: {
  to: string
  shopName: string
  items: CloseReceiptItem[]
  claimUrl: string
  toMerchantDirectly: boolean
}): Promise<void> {
  const { subject, intro, items, claimUrl } = buildMerchantCloseReceipt(ctx)
  const notes = items.map((i) => i.note).filter((n): n is string => !!n)
  const body = [
    h1('Tu recibo de Miyagi Sánchez'),
    p(intro),
    table(items.map((i) => [i.label, i.amountMxn ?? 'GRATIS'] as [string, string])),
    ...(notes.length ? [notice(notes.join('<br>'))] : []),
    cta('Reclamar mi tienda', claimUrl),
  ].join('')
  await send(ctx.to, subject, body)
}
