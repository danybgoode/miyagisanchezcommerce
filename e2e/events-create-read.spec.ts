import { expect, test } from '@playwright/test'

test.describe('events and ticketing · free event create/read', () => {
  test('seller event APIs reject anonymous callers', async ({ request }) => {
    const list = await request.get('/api/sell/events')
    expect(list.status()).toBe(401)

    const create = await request.post('/api/sell/events', {
      data: {
        title: 'Evento anonimo',
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        venue_name: 'Foro',
      },
    })
    expect(create.status()).toBe(401)
  })

  test('secret-gated smoke creates a public event page', async ({ request }) => {
    const secret = process.env.EVENTS_TICKETING_SMOKE_SECRET
    test.skip(!secret, 'Set EVENTS_TICKETING_SMOKE_SECRET to run mutating event create/read smoke.')

    const fixture = await request.post('/api/internal/events-ticketing/smoke', {
      headers: { 'x-events-ticketing-test-secret': secret! },
      data: { keep: true },
    })
    expect(fixture.ok()).toBeTruthy()
    const data = await fixture.json() as {
      event_id: string
      slug: string
      public_url: string
      created_event: boolean
    }

    try {
      expect(data.created_event).toBe(true)
      expect(data.public_url).toContain(`/e/${data.slug}`)

      const page = await request.get(`/e/${data.slug}`)
      expect(page.ok()).toBeTruthy()
      const html = await page.text()
      expect(html).toContain('Evento de prueba RSVP')
      expect(html).toContain('Foro Miyagi')
    } finally {
      await request.delete('/api/internal/events-ticketing/smoke', {
        headers: { 'x-events-ticketing-test-secret': secret! },
        data: { event_id: data.event_id },
      })
    }
  })
})
