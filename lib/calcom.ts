/**
 * Cal.com API v1 client
 *
 * Sellers connect their Cal.com account by pasting their API key
 * (found at cal.com/settings/developer/api-keys).
 *
 * This module is server-only — the API key is never sent to the browser.
 *
 * Cal.com free tier: API access ✓, webhooks ✓, unlimited bookings ✓
 */

const CAL_API_BASE = 'https://api.cal.com/v1'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalUser {
  id:       number
  username: string
  name:     string
  email:    string
  timeZone: string
}

export interface CalEventType {
  id:          number
  slug:        string
  title:       string
  length:      number        // duration in minutes
  description: string | null
}

export interface CalSlot {
  time: string  // ISO 8601
}

export interface CalBooking {
  id:        number
  uid:       string
  title:     string
  startTime: string
  endTime:   string
  attendees: Array<{ name: string; email: string; timeZone: string }>
}

// Stored in marketplace_shops.metadata.settings.calcom
export interface CalcomShopSettings {
  connected:          boolean
  username:           string
  event_type_id:      number
  event_type_slug:    string
  event_type_title:   string
  event_duration_min: number
  booking_url:        string   // https://cal.com/{username}/{event-slug}
  connected_at:       string
}

// ── Internal fetch helper ──────────────────────────────────────────────────────

async function calFetch<T>(path: string, apiKey: string, options?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${CAL_API_BASE}${path}${sep}apiKey=${encodeURIComponent(apiKey)}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    let msg = `Cal.com API error ${res.status}`
    try {
      const body = await res.json() as Record<string, string>
      msg = body.message ?? body.error ?? msg
    } catch {}
    throw new Error(msg)
  }
  return res.json() as T
}

// ── Public functions ──────────────────────────────────────────────────────────

export async function getCalUser(apiKey: string): Promise<CalUser> {
  return calFetch<CalUser>('/me', apiKey)
}

export async function getCalEventTypes(apiKey: string): Promise<CalEventType[]> {
  const data = await calFetch<{ event_types: CalEventType[] }>('/event-types', apiKey)
  return data.event_types ?? []
}

/** Returns slots indexed by date string (e.g. "2026-05-22") */
export async function getCalAvailableSlots(
  apiKey:      string,
  eventTypeId: number,
  dateFrom:    string,  // YYYY-MM-DD
  dateTo:      string,  // YYYY-MM-DD
  timeZone  =  'America/Mexico_City'
): Promise<Record<string, CalSlot[]>> {
  const data = await calFetch<{ slots: Record<string, CalSlot[]> }>(
    `/slots?eventTypeId=${eventTypeId}&startTime=${dateFrom}&endTime=${dateTo}&timeZone=${encodeURIComponent(timeZone)}`,
    apiKey
  )
  return data.slots ?? {}
}

export async function createCalBooking(
  apiKey:      string,
  eventTypeId: number,
  startTime:   string,  // ISO 8601
  name:        string,
  email:       string,
  timeZone  =  'America/Mexico_City',
  notes?:      string
): Promise<CalBooking> {
  return calFetch<CalBooking>('/bookings', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      eventTypeId,
      start:    startTime,
      name,
      email,
      timeZone,
      language: 'es',
      metadata: notes ? { notas: notes } : {},
    }),
  })
}

export function getCalBookingUrl(username: string, eventSlug: string): string {
  return `https://cal.com/${username}/${eventSlug}`
}
