import { test, expect } from '@playwright/test'
import { readEventDetails } from '../lib/event-listing'
import { toUcpListing } from '../lib/ucp/schema'
import type { Listing } from '../lib/types'

function eventListing(attrs: Record<string, unknown>): Listing {
  return {
    id: 'prod_event_123',
    shop_id: 'shop_123',
    medusa_product_id: 'prod_event_123',
    title: 'Taller de ceramica',
    description: 'Entrada al taller',
    price_cents: 50000,
    currency: 'MXN',
    condition: null,
    listing_type: 'service',
    category: 'servicios',
    state: 'Ciudad de México',
    municipio: 'Cuauhtémoc',
    location: 'Cuauhtémoc, Ciudad de México',
    attrs,
    metadata: { attrs },
    images: [{ url: 'https://example.com/event.jpg', alt: 'Evento' }],
    tags: [],
    status: 'active',
    source_platform: null,
    source_url: null,
    views: 0,
    manage_inventory: true,
    available_quantity: 2,
    in_stock: true,
    created_at: '2026-06-07T12:00:00.000Z',
    shop: {
      id: 'shop_123',
      slug: 'taller',
      name: 'Taller Centro',
      description: null,
      location: 'CDMX',
      logo_url: null,
      clerk_user_id: 'user_123',
      verified: true,
      source: null,
      source_url: null,
      metadata: { mp_enabled: true },
      created_at: '2026-06-07T12:00:00.000Z',
      custom_domain: null,
      custom_domain_verified: false,
      custom_domain_vercel_ok: false,
    },
  }
}

test.describe('events and ticketing · listing attrs', () => {
  test('normalizes event attrs from a Medusa listing', () => {
    const details = readEventDetails(eventListing({
      event_date: '2026-07-18',
      event_time: '19:30',
      venue_name: 'Foro Roma',
      venue_address: 'Calle Durango 123, Roma Norte',
    }))

    expect(details).toMatchObject({
      event_date: '2026-07-18',
      event_time: '19:30',
      venue_name: 'Foro Roma',
      venue_address: 'Calle Durango 123, Roma Norte',
      starts_at: '2026-07-18T19:30:00',
    })
    expect(details?.formatted_date).toContain('18')
    expect(details?.formatted_time).toContain('7:30')
  })

  test('UCP listing carries event fields for agents', () => {
    const ucp = toUcpListing(eventListing({
      event_date: '2026-07-18',
      event_time: '19:30',
      venue_name: 'Foro Roma',
      venue_address: 'Calle Durango 123, Roma Norte',
    }))

    expect(ucp.event).toMatchObject({
      event_date: '2026-07-18',
      event_time: '19:30',
      venue_name: 'Foro Roma',
      venue_address: 'Calle Durango 123, Roma Norte',
    })
    expect(ucp.schema_org['@type']).toBe('Event')
    expect(ucp.schema_org.startDate).toBe('2026-07-18T19:30:00')
  })
})
