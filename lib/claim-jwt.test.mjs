import test from 'node:test'
import assert from 'node:assert/strict'
import { signClaimToken, verifyClaimToken } from './claimJwt.ts'

const prior = process.env.CLAIM_JWT_SECRET
process.env.CLAIM_JWT_SECRET = 'test-only-claim-signing-key'

test('signed shop links keep their purpose and shop without a recipient or expiry', async () => {
  const base = { shopId: 'sel_one', shopSlug: 'one', shopName: 'One', market: 'mx', campaignId: 'claim-shop-2026-10' }
  const claim = await signClaimToken({ ...base, purpose: 'campaign' }, null)
  const removal = await signClaimToken({ ...base, purpose: 'removal' }, null)
  assert.equal((await verifyClaimToken(claim)).purpose, 'campaign')
  assert.equal((await verifyClaimToken(removal)).purpose, 'removal')
  assert.equal((await verifyClaimToken(claim)).shopId, base.shopId)
  assert.equal((await verifyClaimToken(claim)).exp, undefined)
  assert.equal((await verifyClaimToken(removal)).email, undefined)
  const [header, body, signature] = claim.split('.')
  await assert.rejects(verifyClaimToken(`${header}.${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`))
})

test('shop links may be evergreen; malformed legacy links still reject', async () => {
  const base = { shopId: 'sel_one', shopSlug: 'one', shopName: 'One', purpose: 'campaign' }
  await assert.rejects(signClaimToken(base, 0))
  await assert.rejects(signClaimToken(base, 15 * 24 * 60 * 60))
  assert.equal((await verifyClaimToken(await signClaimToken({ ...base, purpose: 'public' }, null))).exp, undefined)
  await assert.rejects(signClaimToken({ ...base, purpose: undefined }, null))
  const bounded = await signClaimToken(base, 60)
  assert.ok((await verifyClaimToken(bounded)).exp)
})

test.after(() => {
  if (prior === undefined) delete process.env.CLAIM_JWT_SECRET
  else process.env.CLAIM_JWT_SECRET = prior
})
