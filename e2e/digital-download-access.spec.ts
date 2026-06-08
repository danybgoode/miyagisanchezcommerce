import { test, expect } from '@playwright/test'
import {
  normalizeBuyerEmails,
  resolveDigitalDownloadAccess,
} from '../lib/digital-download-access'

test.describe('events and ticketing · digital download gate', () => {
  test('owner keeps download access', () => {
    const access = resolveDigitalDownloadAccess({
      actor: { userId: 'user_seller', verifiedBuyerEmails: [] },
      ownerClerkUserId: 'user_seller',
      paidOrder: null,
    })

    expect(access).toMatchObject({ allowed: true, role: 'owner' })
  })

  test('verified buyer with a paid order gets download access', () => {
    const access = resolveDigitalDownloadAccess({
      actor: {
        userId: 'user_buyer',
        verifiedBuyerEmails: [],
      },
      ownerClerkUserId: 'user_seller',
      paidOrder: {
        id: 'order_123',
        status: 'fulfilled',
        buyerClerkUserId: 'user_buyer',
        buyerEmail: null,
        medusaOrderId: null,
      },
    })

    expect(access).toMatchObject({ allowed: true, role: 'buyer' })
  })

  test('verified email buyer with a Medusa-backed paid mirror gets download access', () => {
    const access = resolveDigitalDownloadAccess({
      actor: {
        userId: 'user_buyer',
        verifiedBuyerEmails: normalizeBuyerEmails(['Buyer@Example.com']),
      },
      ownerClerkUserId: 'user_seller',
      paidOrder: {
        id: 'order_123',
        status: 'paid',
        buyerClerkUserId: null,
        buyerEmail: 'Buyer@Example.com',
        medusaOrderId: 'order_medusa_123',
      },
    })

    expect(access).toMatchObject({ allowed: true, role: 'buyer' })
  })

  test('stranger without a paid order is payment-gated', () => {
    const access = resolveDigitalDownloadAccess({
      actor: { userId: 'user_stranger', verifiedBuyerEmails: normalizeBuyerEmails(['stranger@example.com']) },
      ownerClerkUserId: 'user_seller',
      paidOrder: null,
    })

    expect(access.allowed).toBe(false)
    expect(access.deniedStatus).toBe(402)
  })

  test('pending orders do not unlock paid artifacts', () => {
    const access = resolveDigitalDownloadAccess({
      actor: { userId: 'user_buyer', verifiedBuyerEmails: normalizeBuyerEmails(['buyer@example.com']) },
      ownerClerkUserId: 'user_seller',
      paidOrder: {
        id: 'order_pending',
        status: 'pending',
        buyerClerkUserId: 'user_buyer',
        buyerEmail: null,
        medusaOrderId: null,
      },
    })

    expect(access.allowed).toBe(false)
    expect(access.deniedStatus).toBe(402)
  })

  test('matching email without Medusa mirror evidence does not unlock paid artifacts', () => {
    const access = resolveDigitalDownloadAccess({
      actor: {
        userId: 'user_buyer',
        verifiedBuyerEmails: normalizeBuyerEmails(['buyer@example.com']),
      },
      ownerClerkUserId: 'user_seller',
      paidOrder: {
        id: 'legacy_email_order',
        status: 'paid',
        buyerClerkUserId: null,
        buyerEmail: 'buyer@example.com',
        medusaOrderId: null,
      },
    })

    expect(access.allowed).toBe(false)
    expect(access.deniedStatus).toBe(402)
  })

  test('unverified or mismatched email does not unlock a Medusa-backed mirror', () => {
    const access = resolveDigitalDownloadAccess({
      actor: {
        userId: 'user_buyer',
        verifiedBuyerEmails: normalizeBuyerEmails(['other@example.com']),
      },
      ownerClerkUserId: 'user_seller',
      paidOrder: {
        id: 'email_order',
        status: 'paid',
        buyerClerkUserId: null,
        buyerEmail: 'buyer@example.com',
        medusaOrderId: 'order_medusa_123',
      },
    })

    expect(access.allowed).toBe(false)
    expect(access.deniedStatus).toBe(402)
  })
})
