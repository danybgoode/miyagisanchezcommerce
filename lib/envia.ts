/**
 * Envia.com multi-carrier shipping API client.
 *
 * Docs:  https://docs.envia.com/
 * Auth:  Bearer token — set ENVIA_API_KEY in .env.local
 * Env:   ENVIA_SANDBOX=true → api-test.envia.com (default in development)
 *        ENVIA_SANDBOX=false → api.envia.com (production)
 *
 * Only use server-side. Never expose the API key to the browser.
 */

// ── Base URL ──────────────────────────────────────────────────────────────────

function baseUrl(): string {
  const isSandbox =
    process.env.ENVIA_SANDBOX === 'true' ||
    (process.env.ENVIA_SANDBOX === undefined && process.env.NODE_ENV !== 'production')
  return isSandbox ? 'https://api-test.envia.com' : 'https://api.envia.com'
}

function apiKey(): string {
  const key = process.env.ENVIA_API_KEY
  if (!key) throw new Error('Missing ENVIA_API_KEY environment variable')
  return key
}

async function enviaFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl()}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = JSON.stringify(body)
    } catch { /* ignore */ }
    throw new Error(`Envia API error ${res.status}: ${detail}`)
  }

  return res.json() as Promise<T>
}

// ── Address shape ─────────────────────────────────────────────────────────────

export interface EnviaAddress {
  /** Full name of sender/recipient */
  name: string
  /** Company name (optional) */
  company?: string
  email?: string
  phone?: string
  /** Street + number, e.g. "Av. Insurgentes Sur 1234" */
  street: string
  /** Interior/exterior number (Envia splits these) */
  number?: string
  /** Colonia/neighborhood */
  district?: string
  city: string
  /** 2-letter state code, e.g. "CDMX", "JAL", "NL" */
  state: string
  /** ISO country code */
  country?: string
  postalCode: string
}

// ── Package shape ─────────────────────────────────────────────────────────────

export interface EnviaPackage {
  /** Product description */
  content: string
  /** Number of identical packages */
  amount?: number
  /** 'box' | 'envelope' | 'pallet' */
  type?: string
  /** Weight in kg (e.g. 0.5 = 500g) */
  weight: number
  /** Declared value for insurance (MXN) */
  declaredValue?: number
  dimensions?: {
    length: number
    width: number
    height: number
  }
}

// ── Quote ─────────────────────────────────────────────────────────────────────

export interface EnviaQuoteParams {
  origin: EnviaAddress
  destination: EnviaAddress
  packages: EnviaPackage[]
  /** Optional: filter to specific carriers */
  carriers?: string[]
}

export interface EnviaRate {
  /** Envia rate ID — pass this to createShipment */
  rateId: string
  carrier: string
  /** Service level name, e.g. "Express", "Standard" */
  service: string
  /** Total shipping cost in MXN */
  totalPrice: number
  currency: string
  /** Estimated delivery in business days */
  deliveryEstimate: number | null
  /** Carrier logo URL */
  logoUrl?: string
}

interface RawRate {
  rateId?: string
  carrier?: string
  service?: string
  totalPrice?: number
  currency?: string
  deliveryEstimate?: number | null
  carrierLogo?: string
  [key: string]: unknown
}

export async function quoteShipments(params: EnviaQuoteParams): Promise<EnviaRate[]> {
  const body = {
    origin: { country: 'MX', ...params.origin },
    destination: { country: 'MX', ...params.destination },
    packages: params.packages.map(p => ({
      content: p.content,
      amount: p.amount ?? 1,
      type: p.type ?? 'box',
      weight: p.weight,
      insurance: 0,
      declaredValue: p.declaredValue ?? 0,
      weightUnit: 'KG',
      lengthUnit: 'CM',
      dimensions: p.dimensions ?? { length: 20, width: 15, height: 10 },
    })),
  }

  const res = await enviaFetch<{ data?: RawRate[] }>('/v4/shipments/quote', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  return (res.data ?? []).map((r: RawRate) => ({
    rateId: String(r.rateId ?? ''),
    carrier: String(r.carrier ?? ''),
    service: String(r.service ?? ''),
    totalPrice: Number(r.totalPrice ?? 0),
    currency: String(r.currency ?? 'MXN'),
    deliveryEstimate: r.deliveryEstimate != null ? Number(r.deliveryEstimate) : null,
    logoUrl: r.carrierLogo as string | undefined,
  }))
}

// ── Create shipment (generate label) ─────────────────────────────────────────

export interface CreateShipmentParams {
  origin: EnviaAddress
  destination: EnviaAddress
  packages: EnviaPackage[]
  rateId: string
  /** Internal reference (order ID) */
  reference?: string
}

export interface CreatedShipment {
  enviaShipmentId: string
  carrier: string
  trackingNumber: string | null
  labelUrl: string | null
  estimatedDeliveryDate: string | null
  /** Raw response from Envia */
  raw: Record<string, unknown>
}

interface RawCreatedShipment {
  data?: {
    shipmentId?: string
    carrier?: string
    trackingNumber?: string
    label?: { labelUrl?: string; url?: string }
    estimatedDeliveryDate?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export async function createShipment(params: CreateShipmentParams): Promise<CreatedShipment> {
  const body = {
    origin: { country: 'MX', ...params.origin },
    destination: { country: 'MX', ...params.destination },
    packages: params.packages.map(p => ({
      content: p.content,
      amount: p.amount ?? 1,
      type: p.type ?? 'box',
      weight: p.weight,
      insurance: 0,
      declaredValue: p.declaredValue ?? 0,
      weightUnit: 'KG',
      lengthUnit: 'CM',
      dimensions: p.dimensions ?? { length: 20, width: 15, height: 10 },
    })),
    carrier: { rateId: params.rateId },
    settings: {
      labelFormat: 'PDF',
      comments: params.reference ?? '',
    },
  }

  const res = await enviaFetch<RawCreatedShipment>('/v4/shipments', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  const d = res.data ?? {}
  const labelUrl = (d.label as Record<string, string> | undefined)?.labelUrl
    ?? (d.label as Record<string, string> | undefined)?.url
    ?? null

  return {
    enviaShipmentId: String(d.shipmentId ?? ''),
    carrier: String(d.carrier ?? ''),
    trackingNumber: d.trackingNumber ? String(d.trackingNumber) : null,
    labelUrl: labelUrl,
    estimatedDeliveryDate: d.estimatedDeliveryDate ? String(d.estimatedDeliveryDate) : null,
    raw: res as Record<string, unknown>,
  }
}

// ── Tracking ──────────────────────────────────────────────────────────────────

export interface TrackingEvent {
  timestamp: string
  status: string
  description: string
  location?: string
}

export interface TrackingInfo {
  trackingNumber: string
  carrier: string
  status: string
  estimatedDelivery: string | null
  events: TrackingEvent[]
}

interface RawTracking {
  data?: {
    trackingNumber?: string
    carrier?: string
    status?: string
    estimatedDelivery?: string | null
    history?: Array<{
      timestamp?: string
      status?: string
      description?: string
      location?: string
    }>
  }
}

export async function getTracking(
  trackingNumber: string,
  carrier?: string,
): Promise<TrackingInfo | null> {
  try {
    const params = new URLSearchParams({ trackingNumber })
    if (carrier) params.set('carrier', carrier)

    const res = await enviaFetch<RawTracking>(`/v4/tracking?${params}`)
    const d = res.data
    if (!d) return null

    return {
      trackingNumber: d.trackingNumber ?? trackingNumber,
      carrier: d.carrier ?? carrier ?? '',
      status: d.status ?? 'unknown',
      estimatedDelivery: d.estimatedDelivery ?? null,
      events: (d.history ?? []).map(e => ({
        timestamp: e.timestamp ?? '',
        status: e.status ?? '',
        description: e.description ?? '',
        location: e.location,
      })),
    }
  } catch (err) {
    console.error('[envia] getTracking failed:', err)
    return null
  }
}

// ── Carrier tracking URLs ─────────────────────────────────────────────────────
// Fallback links to the carrier's own tracking page when Envia tracking is unavailable.

export function carrierTrackingUrl(carrier: string, trackingNumber: string): string | null {
  const c = carrier.toLowerCase()
  if (c === 'dhl')
    return `https://www.dhl.com/mx-es/home/tracking.html?tracking-id=${encodeURIComponent(trackingNumber)}`
  if (c === 'fedex')
    return `https://www.fedex.com/fedextrack/?tracknumbers=${encodeURIComponent(trackingNumber)}&locale=es_MX`
  if (c === 'estafeta')
    return `https://rastreo.estafeta.com/?wayBillNumber=${encodeURIComponent(trackingNumber)}`
  if (c === 'ups')
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}&requester=WT/trackdetails`
  if (c === 'redpack')
    return `https://www.redpack.com.mx/rastreo/?guia=${encodeURIComponent(trackingNumber)}`
  if (c === 'paquetexpress')
    return `https://www.paquetexpress.com.mx/rastreo?n=${encodeURIComponent(trackingNumber)}`
  return null
}

// ── Carrier display labels ────────────────────────────────────────────────────

export const CARRIER_LABELS: Record<string, string> = {
  dhl:           'DHL',
  fedex:         'FedEx',
  estafeta:      'Estafeta',
  ups:           'UPS',
  redpack:       'Redpack',
  paquetexpress: 'Paquetexpress',
  manual:        'Envío propio',
}

export function carrierLabel(carrier: string): string {
  return CARRIER_LABELS[carrier.toLowerCase()] ?? carrier
}
