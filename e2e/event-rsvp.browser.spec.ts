import { expect, test } from '@playwright/test'

test.describe('events and ticketing · public RSVP page', () => {
  test('renders /e/[slug] anonymously and accepts code entry', async ({ page, request }) => {
    const secret = process.env.EVENTS_TICKETING_SMOKE_SECRET
    const configuredSlug = process.env.EVENTS_TICKETING_BROWSER_SLUG
    test.skip(!secret && !configuredSlug, 'Set EVENTS_TICKETING_SMOKE_SECRET or EVENTS_TICKETING_BROWSER_SLUG to run event browser smoke.')

    let eventId: string | null = null
    let slug = configuredSlug ?? ''

    if (!slug) {
      const fixture = await request.post('/api/internal/events-ticketing/smoke', {
        headers: { 'x-events-ticketing-test-secret': secret! },
        data: { keep: true, register: false },
      })
      expect(fixture.ok()).toBeTruthy()
      const data = await fixture.json() as { event_id: string; slug: string }
      eventId = data.event_id
      slug = data.slug
    }

    try {
      await page.goto(`/e/${slug}`)
      await expect(page.getByTestId('event-title')).toBeVisible()
      await expect(page.getByTestId('event-venue')).toBeVisible()
      await expect(page.getByTestId('event-email-input')).toBeVisible()
      await expect(page.getByTestId('event-code-input')).toBeVisible()

      await page.getByTestId('event-name-input').fill('Visitante Smoke')
      await page.getByTestId('event-email-input').fill(`browser-${Date.now()}@example.com`)
      await page.getByTestId('event-code-input').fill('BAD000')
      await expect(page.getByTestId('event-name-input')).toHaveValue('Visitante Smoke')
      await expect(page.getByTestId('event-code-input')).toHaveValue('BAD000')
    } finally {
      if (secret && eventId) {
        await request.delete('/api/internal/events-ticketing/smoke', {
          headers: { 'x-events-ticketing-test-secret': secret },
          data: { event_id: eventId },
        })
      }
    }
  })
})
