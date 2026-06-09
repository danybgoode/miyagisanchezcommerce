import { test, expect } from '@playwright/test'

// API-level auth-gate spec for the two-sided pickup-appointment transitions (Delivery &
// Manual-Money Polish S2.2). The confirm/reschedule guards live behind Clerk auth +
// seller/buyer ownership, so anonymously we assert the gate: every mutating endpoint
// rejects an unauthenticated caller. The full propose→confirm→reschedule→confirm round-
// trip is the authed browser smoke owed to Daniel (see sprint-2.md).

const ORDER = 'order_test_pickup'

test.describe('pickup appointment · seller PATCH (S2.2) · auth gate', () => {
  test('seller "confirm" rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch(`/api/orders/${ORDER}/pickup-appointment/manage`, {
      data: { action: 'confirm' },
    })
    expect(res.status()).toBe(401)
  })

  test('seller "reschedule" rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch(`/api/orders/${ORDER}/pickup-appointment/manage`, {
      data: { action: 'reschedule', date: '2026-06-20', window: 'tarde' },
    })
    expect(res.status()).toBe(401)
  })
})

test.describe('pickup appointment · buyer PATCH (S2.2) · auth gate', () => {
  test('buyer "confirm" rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch(`/api/orders/${ORDER}/pickup-appointment`, {
      data: { action: 'confirm' },
    })
    expect(res.status()).toBe(401)
  })
})
