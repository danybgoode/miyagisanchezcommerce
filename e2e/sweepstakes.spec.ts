import { expect, test } from '@playwright/test'

test.describe('Sweepstakes guardrails', () => {
  test('seller campaign APIs reject anonymous callers', async ({ request }) => {
    const list = await request.get('/api/sell/sweepstakes')
    expect(list.status()).toBe(401)

    const create = await request.post('/api/sell/sweepstakes', {
      data: { title_es: 'Sorteo', title_en: 'Sweepstakes' },
    })
    expect(create.status()).toBe(401)
  })

  test('public entry APIs do not create entries for an unknown or disabled campaign', async ({ request }) => {
    const suffix = Date.now()
    const verification = await request.post(`/api/sweepstakes/not-a-campaign-${suffix}/verification`, {
      data: { email: 'test@example.com', locale: 'en' },
    })
    expect([404, 423]).toContain(verification.status())

    const entry = await request.post(`/api/sweepstakes/not-a-campaign-${suffix}/entries`, {
      data: { name: 'Test', email: 'test@example.com', code: 'ABC123', locale: 'en' },
    })
    expect([404, 423]).toContain(entry.status())
  })

  test('draw cron requires cron authentication', async ({ request }) => {
    const res = await request.get('/api/cron/sweepstakes-draw')
    expect(res.status()).toBe(401)
  })
})

test.describe('Sweepstakes idempotency', () => {
  test('purchase bonus and draw survive double-fire', async ({ request }) => {
    const secret = process.env.SWEEPSTAKES_IDEMPOTENCY_TEST_SECRET
    test.skip(!secret, 'Set SWEEPSTAKES_IDEMPOTENCY_TEST_SECRET to run mutating idempotency smoke.')

    const res = await request.post('/api/internal/sweepstakes/idempotency', {
      headers: { 'x-sweepstakes-test-secret': secret! },
    })
    expect(res.ok()).toBeTruthy()
    const data = await res.json() as {
      legal_gate_blocked: boolean
      duplicate_free_entry_same_entry: boolean
      duplicate_free_ticket_count: number
      expected_free_ticket_count: number
      purchase_ticket_rows: number
      expected_purchase_ticket_rows: number
      kill_switch_blocked_purchase_rows: number
      kill_switch_blocked_draw: boolean
      kill_switch_blocked_broadcast: boolean
      draw_rows: number
      same_draw: boolean
    }
    expect(data.legal_gate_blocked).toBe(true)
    expect(data.duplicate_free_entry_same_entry).toBe(true)
    expect(data.duplicate_free_ticket_count).toBe(data.expected_free_ticket_count)
    expect(data.purchase_ticket_rows).toBe(data.expected_purchase_ticket_rows)
    expect(data.kill_switch_blocked_purchase_rows).toBe(0)
    expect(data.kill_switch_blocked_draw).toBe(true)
    expect(data.kill_switch_blocked_broadcast).toBe(true)
    expect(data.draw_rows).toBe(1)
    expect(data.same_draw).toBe(true)
  })
})
