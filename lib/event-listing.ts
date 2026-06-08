import type { Listing } from './types'

export interface ListingEventDetails {
  event_date: string | null
  event_time: string | null
  venue_name: string | null
  venue_address: string | null
  formatted_date: string | null
  formatted_time: string | null
  location_label: string | null
  starts_at: string | null
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function listingAttrs(listing: Pick<Listing, 'attrs' | 'metadata'>): Record<string, unknown> {
  const fromField = listing.attrs
  if (fromField && typeof fromField === 'object') return fromField
  const fromMetadata = listing.metadata?.attrs
  return fromMetadata && typeof fromMetadata === 'object'
    ? fromMetadata as Record<string, unknown>
    : {}
}

export function formatEventDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function formatEventTime(value: string | null): string | null {
  if (!value) return null
  const [hh, mm = '00'] = value.split(':')
  const hour = Number(hh)
  const minute = Number(mm)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value
  return new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(2000, 0, 1, hour, minute))
}

export function readEventDetails(listing: Pick<Listing, 'attrs' | 'metadata'>): ListingEventDetails | null {
  const attrs = listingAttrs(listing)
  const eventDate = cleanString(attrs.event_date)
  const eventTime = cleanString(attrs.event_time)
  const venueName = cleanString(attrs.venue_name)
  const venueAddress = cleanString(attrs.venue_address)

  if (!eventDate && !eventTime && !venueName && !venueAddress) return null

  return {
    event_date: eventDate,
    event_time: eventTime,
    venue_name: venueName,
    venue_address: venueAddress,
    formatted_date: formatEventDate(eventDate),
    formatted_time: formatEventTime(eventTime),
    location_label: venueName ?? venueAddress,
    starts_at: eventDate ? `${eventDate}${eventTime ? `T${eventTime}:00` : ''}` : null,
  }
}
