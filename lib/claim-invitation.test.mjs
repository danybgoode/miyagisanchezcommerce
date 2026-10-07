import test from 'node:test'
import assert from 'node:assert/strict'
import { decideClaimRedemption, buildClaimLandingUrl, buildRemovalLandingUrl } from './claim-invitation.ts'

const invite = {
  shopId: 'sel_shop_1', shopSlug: 'la-tienda', shopName: 'La Tienda',
  purpose: 'campaign', market: 'mx', iat: 1,
}
const shop = {
  id: 'sel_shop_1', slug: 'la-tienda', clerkUserId: null, verified: true,
  market: 'mx', status: 'active',
}
const actor = { clerkUserId: 'user_1' }

test('any signed-in account can claim exactly the invited active shop', () => {
  assert.deepEqual(decideClaimRedemption(invite, shop, actor), { ok: true, newlyClaimable: true })
  assert.deepEqual(decideClaimRedemption(invite, { ...shop, clerkUserId: 'user_1' }, actor), { ok: true, newlyClaimable: false })
})

test('the address used for outreach never restricts the account used to claim', () => {
  assert.deepEqual(decideClaimRedemption({ ...invite, email: 'public@shop.example' }, shop, actor), { ok: true, newlyClaimable: true })
  assert.deepEqual(decideClaimRedemption({ ...invite, email: undefined }, shop, { clerkUserId: 'google_account' }), { ok: true, newlyClaimable: true })
})

test('a public shop claim is immediate; a removal or malformed link cannot claim', () => {
  assert.deepEqual(decideClaimRedemption({ ...invite, purpose: 'public' }, shop, actor), { ok: true, newlyClaimable: true })
  assert.deepEqual(decideClaimRedemption({ ...invite, purpose: undefined }, shop, actor), { ok: false, reason: 'invalid_link' })
  assert.deepEqual(decideClaimRedemption({ ...invite, purpose: 'removal' }, shop, actor), { ok: false, reason: 'invalid_link' })
})

test('removal URL carries a shop-bound opaque invitation', () => {
  const url = new URL(buildRemovalLandingUrl('removal.token.signature'))
  assert.equal(url.origin, 'https://miyagisanchez.com')
  assert.equal(url.pathname, '/remove-shop')
  assert.equal(url.searchParams.get('token'), 'removal.token.signature')
})

test('shop, market, ownership and pause boundaries stay bound to the invite', () => {
  assert.deepEqual(decideClaimRedemption(invite, { ...shop, id: 'sel_other' }, actor), { ok: false, reason: 'wrong_shop' })
  assert.deepEqual(decideClaimRedemption(invite, { ...shop, market: 'us' }, actor), { ok: false, reason: 'wrong_market' })
  assert.deepEqual(decideClaimRedemption(invite, { ...shop, status: 'paused' }, actor), { ok: false, reason: 'shop_unavailable' })
  assert.deepEqual(decideClaimRedemption(invite, { ...shop, verified: false }, actor), { ok: false, reason: 'shop_unavailable' })
  assert.deepEqual(decideClaimRedemption(invite, { ...shop, clerkUserId: 'user_other' }, actor), { ok: false, reason: 'already_claimed' })
})

test('landing URL keeps the opaque token in the correct query parameter', () => {
  const url = new URL(buildClaimLandingUrl('a.b.c'))
  assert.equal(url.origin, 'https://miyagisanchez.com')
  assert.equal(url.pathname, '/claim')
  assert.equal(url.searchParams.get('token'), 'a.b.c')
})
