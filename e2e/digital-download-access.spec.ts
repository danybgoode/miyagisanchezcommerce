import { test, expect } from '@playwright/test'
import {
  normalizeBuyerEmails,
  resolveDigitalDownloadAccess,
} from '../lib/digital-download-access'

test.describe('events and ticketing · digital download gate', () => {
  test('owner keeps download access', () => {
    const access = resolveDigitalDownloadAccess({
      actor: { userId: 'user_seller', buyerEmails: [] },
      ownerClerkUserId: 'user_seller',
      paidOrder: null,
    })

    expect(access).toMatchObject({ allowed: true, role: 'owner' })
  })

  test('verified buyer with a paid order gets download access', () => {
    const access = resolveDigitalDownloadAccess({
      actor: {
        userId: 'user_buyer',
        buyerEmails: normalizeBuyerEmails(['Buyer@Example.com']),
      },
      ownerClerkUserId: 'user_seller',
      paidOrder: { id: 'order_123', status: 'fulfilled' },
    })

    expect(access).toMatchObject({ allowed: true, role: 'buyer' })
  })

  test('stranger without a paid order is payment-gated', () => {
    const access = resolveDigitalDownloadAccess({
      actor: { userId: 'user_stranger', buyerEmails: normalizeBuyerEmails(['stranger@example.com']) },
      ownerClerkUserId: 'user_seller',
      paidOrder: null,
    })

    expect(access.allowed).toBe(false)
    expect(access.deniedStatus).toBe(402)
  })

  test('pending orders do not unlock paid artifacts', () => {
    const access = resolveDigitalDownloadAccess({
      actor: { userId: 'user_buyer', buyerEmails: normalizeBuyerEmails(['buyer@example.com']) },
      ownerClerkUserId: 'user_seller',
      paidOrder: { id: 'order_pending', status: 'pending' },
    })

    expect(access.allowed).toBe(false)
    expect(access.deniedStatus).toBe(402)
  })
})
