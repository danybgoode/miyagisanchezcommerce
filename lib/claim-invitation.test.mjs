import test from 'node:test'
import assert from 'node:assert/strict'
import { decideClaimRedemption, buildClaimLandingUrl, buildRemovalLandingUrl, canRedeemClaimToken, canIssuePublicClaimLink, normalizedClaimEmail } from './claim-invitation.ts'

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

test('unexpired legacy email links can finish on Miyagi without matching the account email', () => {
  const legacy = { ...invite, purpose: undefined, email: 'outreach@shop.example', exp: 2_000_000_000 }
  assert.equal(canRedeemClaimToken(legacy), true)
  assert.deepEqual(decideClaimRedemption(legacy, shop, { clerkUserId: 'different-email-account' }), { ok: true, newlyClaimable: true })
  assert.equal(canRedeemClaimToken({ ...legacy, email: undefined }), false)
})

test('a public request cannot sign another shop or a claimed shop', () => {
  const submitted = { shopId: shop.id, shopSlug: shop.slug, market: 'mx' }
  assert.equal(canIssuePublicClaimLink(submitted, shop), true)
  assert.equal(canIssuePublicClaimLink({ ...submitted, shopId: 'sel_other' }, shop), false)
  assert.equal(canIssuePublicClaimLink({ ...submitted, shopSlug: 'other' }, shop), false)
  assert.equal(canIssuePublicClaimLink(submitted, { ...shop, clerkUserId: 'user_other' }), false)
  assert.equal(canIssuePublicClaimLink(submitted, { ...shop, market: 'us' }), false)
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

test('claim email validation rejects oversized input before parsing it', () => {
  assert.equal(normalizedClaimEmail('owner@example.com'), 'owner@example.com')
  assert.equal(normalizedClaimEmail(`${'a'.repeat(100_000)}@example.com`), null)
})
