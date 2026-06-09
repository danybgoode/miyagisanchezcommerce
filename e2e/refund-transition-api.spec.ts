import { test, expect } from '@playwright/test'

// API-level auth-gate spec for the two-sided refund transitions (Delivery & Manual-Money
// Polish S1). The 422/409 transition guards live behind Clerk auth + seller/buyer
// ownership, so anonymously we assert the gate: every mutating endpoint rejects an
// unauthenticated caller. The full 422/409 round-trip is the money/auth browser smoke
// owed to Daniel (see sprint-1.md).

const ORDER = 'order_test_refund'

test.describe('refund transitions · seller PATCH (S1.2) · auth gate', () => {
  test('seller "accept" rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch(`/api/orders/${ORDER}/return-request/current`, {
      data: { action: 'accept' },
    })
    expect(res.status()).toBe(401)
  })

  test('seller "transfer_sent" (Ya transferí) rejects anonymous with 401', async ({ request }) => {
    const res = await request.patch(`/api/orders/${ORDER}/return-request/current`, {
      data: { action: 'transfer_sent' },
    })
    expect(res.status()).toBe(401)
  })
})
