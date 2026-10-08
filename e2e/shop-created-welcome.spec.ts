import { expect, test } from '@playwright/test'
import { planShopCreatedWelcome } from '../lib/shop-created-welcome-plan'

const seller = { id: 'sel_new', name: 'Studio <South>', slug: 'studio-south' }

test('shop-created welcome follows persisted market, not a signup locale', () => {
  const us = planShopCreatedWelcome({ ...seller, metadata: { operating_market: 'us' } }, 'owner@example.com')
  expect(us).toEqual({ ok: true, context: {
    to: 'owner@example.com', shopName: seller.name, shopSlug: seller.slug,
    sellerId: seller.id, market: 'us',
  } })
  const mx = planShopCreatedWelcome({ ...seller, metadata: { operating_market: 'mx' } }, 'owner@example.com')
  expect(mx.ok && mx.context.market).toBe('mx')
})

test('unknown market or missing owner address stops delivery instead of guessing', () => {
  expect(planShopCreatedWelcome({ ...seller, metadata: { operating_market: 'es-MX' } }, 'owner@example.com'))
    .toEqual({ ok: false, reason: 'market_unavailable' })
  expect(planShopCreatedWelcome({ ...seller }, 'owner@example.com'))
    .toEqual({ ok: false, reason: 'market_unavailable' })
  expect(planShopCreatedWelcome({ ...seller, metadata: { operating_market: 'mx' } }, null))
    .toEqual({ ok: false, reason: 'recipient_unavailable' })
})
