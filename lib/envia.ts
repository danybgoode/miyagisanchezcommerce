/**
 * Envia.com multi-carrier shipping API client.
 *
 * Docs:  https://docs.envia.com/
 * Auth:  Bearer token — set ENVIA_API_KEY in .env.local
 * Env:   ENVIA_SANDBOX=true -> api-test.envia.com (default in development)
 *        ENVIA_SANDBOX=false -> api.envia.com (production)
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

const DEFAULT_MX_CARRIERS = ['dhl', 'fedex', 'estafeta', 'ups', 'redpack', 'paquetexpress']

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
  serviceDescription?: string
  totalPrice?: number
  basePrice?: number
  currency?: string
  deliveryEstimate?: number | string | null
  deliveryDate?: { dateDifference?: number | string | null }
  carrierLogo?: string
  [key: string]: unknown
}

function packageBody(p: EnviaPackage) {
  return {
    content: p.content,
    amount: p.amount ?? 1,
    type: p.type ?? 'box',
    weight: p.weight,
    insurance: 0,
    declaredValue: p.declaredValue ?? 0,
    weightUnit: 'KG',
    lengthUnit: 'CM',
    dimensions: p.dimensions ?? { length: 20, width: 15, height: 10 },
  }
}

function selectedRateId(rate: RawRate) {
  if (rate.rateId) return String(rate.rateId)
  if (rate.carrier && rate.service) {
    return JSON.stringify({ carrier: rate.carrier, service: rate.service })
  }
  return ''
}

function deliveryEstimateDays(rate: RawRate) {
  if (typeof rate.deliveryEstimate === 'number') return rate.deliveryEstimate
  const dateDifference = rate.deliveryDate?.dateDifference
  if (typeof dateDifference === 'number') return dateDifference
  if (typeof dateDifference === 'string') {
    const parsed = Number(dateDifference)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export async function quoteShipments(params: EnviaQuoteParams): Promise<EnviaRate[]> {
  const baseBody = {
    origin: { country: 'MX', ...params.origin },
    destination: { country: 'MX', ...params.destination },
    packages: params.packages.map(packageBody),
    settings: { currency: 'MXN' },
  }

  const carriers = params.carriers?.length ? params.carriers : DEFAULT_MX_CARRIERS
  const settled = await Promise.allSettled(
    carriers.map(carrier => enviaFetch<{ data?: RawRate[] }>('/ship/rate/', {
      method: 'POST',
      body: JSON.stringify({
        ...baseBody,
        shipment: { type: 1, carrier },
      }),
    })),
  )

  const rates = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value.data ?? []
    console.warn(`[envia] quote failed for ${carriers[index]}:`, result.reason)
    return []
  })

  if (rates.length === 0) {
    const firstError = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (firstError) throw firstError.reason
  }

  return rates.map((r: RawRate) => ({
    rateId: selectedRateId(r),
    carrier: String(r.carrier ?? ''),
    service: String(r.serviceDescription ?? r.service ?? ''),
    totalPrice: Number(r.totalPrice ?? r.basePrice ?? 0),
    currency: String(r.currency ?? 'MXN'),
    deliveryEstimate: deliveryEstimateDays(r),
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
    service?: string
    trackingNumber?: string
    trackUrl?: string
    label?: string | { labelUrl?: string; url?: string }
    estimatedDeliveryDate?: string
    [key: string]: unknown
  } | Array<{
    shipmentId?: string
    carrier?: string
    service?: string
    trackingNumber?: string
    trackUrl?: string
    label?: string | { labelUrl?: string; url?: string }
    estimatedDeliveryDate?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

function shipmentSelection(rateId: string) {
  try {
    const parsed = JSON.parse(rateId) as { carrier?: string; service?: string }
    if (parsed.carrier && parsed.service) {
      return { type: 1, carrier: parsed.carrier, service: parsed.service }
    }
  } catch { /* fallback below */ }

  const [carrier, service] = rateId.split(':')
  if (carrier && service) return { type: 1, carrier, service }
  return { type: 1, rateId }
}

export async function createShipment(params: CreateShipmentParams): Promise<CreatedShipment> {
  const body = {
    origin: { country: 'MX', ...params.origin },
    destination: { country: 'MX', ...params.destination },
    packages: params.packages.map(packageBody),
    shipment: shipmentSelection(params.rateId),
    settings: {
      printFormat: 'PDF',
      printSize: 'STOCK_4X6',
      comments: params.reference ?? '',
    },
  }

  const res = await enviaFetch<RawCreatedShipment>('/ship/generate/', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  const d = Array.isArray(res.data) ? (res.data[0] ?? {}) : (res.data ?? {})
  const labelUrl = typeof d.label === 'string'
    ? d.label
    : (d.label as Record<string, string> | undefined)?.labelUrl
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
    events?: Array<{
      timestamp?: string
      status?: string
      description?: string
      location?: string
    }>
    history?: Array<{
      timestamp?: string
      status?: string
      description?: string
      location?: string
    }>
  } | Array<{
    trackingNumber?: string
    carrier?: string
    status?: string
    estimatedDelivery?: string | null
    events?: Array<{
      timestamp?: string
      status?: string
      description?: string
      location?: string
    }>
    history?: Array<{
      timestamp?: string
      status?: string
      description?: string
      location?: string
    }>
  }>
}

export async function getTracking(
  trackingNumber: string,
  carrier?: string,
): Promise<TrackingInfo | null> {
  try {
    const res = await enviaFetch<RawTracking>('/ship/generaltrack/', {
      method: 'POST',
      body: JSON.stringify({ trackingNumbers: [trackingNumber] }),
    })
    const d = Array.isArray(res.data) ? res.data[0] : res.data
    if (!d) return null
    const events = d.events ?? d.history ?? []

    return {
      trackingNumber: d.trackingNumber ?? trackingNumber,
      carrier: d.carrier ?? carrier ?? '',
      status: d.status ?? 'unknown',
      estimatedDelivery: d.estimatedDelivery ?? null,
      events: events.map(e => ({
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
