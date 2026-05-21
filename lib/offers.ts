// ── Offer types & state machine ───────────────────────────────────────────────

export type OfferStatus =
  | 'pending'    // awaiting seller response (48h)
  | 'accepted'   // seller accepted, checkout link sent to buyer (24h to pay)
  | 'declined'   // seller declined
  | 'countered'  // seller countered (24h for buyer to respond)
  | 'expired'    // no seller response within 48h
  | 'withdrawn'  // buyer cancelled before response
  | 'paid'       // payment completed via Stripe

export interface Offer {
  id: string
  listing_id: string
  shop_id: string
  buyer_clerk_user_id: string | null
  buyer_email: string
  buyer_name: string
  offer_amount_cents: number
  message: string | null
  status: OfferStatus
  counter_amount_cents: number | null
  counter_message: string | null
  counter_expires_at: string | null
  checkout_session_id: string | null
  checkout_expires_at: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

// ── State machine guards ──────────────────────────────────────────────────────

export function isExpired(offer: Pick<Offer, 'status' | 'expires_at'>): boolean {
  return offer.status === 'pending' && new Date(offer.expires_at) < new Date()
}

export function isCounterExpired(offer: Pick<Offer, 'status' | 'counter_expires_at'>): boolean {
  return (
    offer.status === 'countered' &&
    !!offer.counter_expires_at &&
    new Date(offer.counter_expires_at) < new Date()
  )
}

export function canAccept(offer: Pick<Offer, 'status' | 'expires_at'>): boolean {
  return offer.status === 'pending' && !isExpired(offer)
}

export function canCounter(offer: Pick<Offer, 'status' | 'expires_at'>): boolean {
  return offer.status === 'pending' && !isExpired(offer)
}

export function canDecline(offer: Pick<Offer, 'status'>): boolean {
  return offer.status === 'pending' || offer.status === 'countered'
}

export function canWithdraw(offer: Pick<Offer, 'status'>): boolean {
  return offer.status === 'pending' || offer.status === 'countered'
}

export function canAcceptCounter(offer: Pick<Offer, 'status' | 'counter_expires_at'>): boolean {
  return offer.status === 'countered' && !isCounterExpired(offer)
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatOfferAmount(cents: number, currency = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export function offerQuality(offerCents: number, askingCents: number): {
  pct: number
  label: string
  color: 'green' | 'amber' | 'red'
} {
  const pct = Math.round((offerCents / askingCents) * 100)
  if (pct >= 85) return { pct, label: 'Oferta razonable', color: 'green' }
  if (pct >= 70) return { pct, label: 'Algo por debajo', color: 'amber' }
  return { pct, label: 'Oferta baja', color: 'red' }
}

// ── Time helpers ──────────────────────────────────────────────────────────────

export function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Expirada'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `hace ${days}d`
}

// ── Anchors ───────────────────────────────────────────────────────────────────

export const OFFER_ANCHORS = [
  { pct: 10, label: '-10%' },
  { pct: 15, label: '-15%' },
  { pct: 20, label: '-20%' },
] as const

export function anchorAmount(askingCents: number, discountPct: number): number {
  return Math.round(askingCents * (1 - discountPct / 100))
}

// ── Validation ────────────────────────────────────────────────────────────────

export const OFFER_FLOOR_PCT = 30   // hard block below 30% of asking
export const OFFER_WARN_PCT  = 50   // amber warning below 50% of asking

export function validateOfferAmount(
  offerCents: number,
  askingCents: number
): { ok: boolean; level: 'ok' | 'warn' | 'block'; message?: string } {
  if (offerCents <= 0 || isNaN(offerCents)) {
    return { ok: false, level: 'block', message: 'Ingresa un monto válido.' }
  }
  if (offerCents >= askingCents) {
    return { ok: false, level: 'block', message: 'La oferta debe ser menor al precio de venta. Usa "Comprar ahora".' }
  }
  const pct = (offerCents / askingCents) * 100
  if (pct < OFFER_FLOOR_PCT) {
    return { ok: false, level: 'block', message: `Monto muy bajo. El mínimo es el ${OFFER_FLOOR_PCT}% del precio.` }
  }
  if (pct < OFFER_WARN_PCT) {
    return { ok: true, level: 'warn', message: 'Oferta muy baja — el vendedor probablemente la rechazará.' }
  }
  return { ok: true, level: 'ok' }
}
