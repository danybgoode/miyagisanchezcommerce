import test from 'node:test'
import assert from 'node:assert/strict'
import { signClaimToken, verifyClaimToken } from './claimJwt.ts'

const prior = process.env.CLAIM_JWT_SECRET
process.env.CLAIM_JWT_SECRET = 'test-only-claim-signing-key'

test('signed campaign and removal links keep their purpose, recipient and expiry', async () => {
  const base = { shopId: 'sel_one', shopSlug: 'one', shopName: 'One', email: 'owner@example.com', market: 'mx', campaignId: 'claim-shop-2026-10' }
  const claim = await signClaimToken({ ...base, purpose: 'campaign' }, 3600)
  const removal = await signClaimToken({ ...base, purpose: 'removal' }, 3600)
  assert.equal((await verifyClaimToken(claim)).purpose, 'campaign')
  assert.equal((await verifyClaimToken(removal)).purpose, 'removal')
  assert.equal((await verifyClaimToken(removal)).email, base.email)
  await assert.rejects(verifyClaimToken(`${claim.slice(0, -1)}${claim.endsWith('A') ? 'B' : 'A'}`))
})

test('claim invitations cannot be minted without a bounded expiry', async () => {
  const base = { shopId: 'sel_one', shopSlug: 'one', shopName: 'One', email: 'owner@example.com', purpose: 'campaign' }
  await assert.rejects(signClaimToken(base, 0))
  await assert.rejects(signClaimToken(base, 15 * 24 * 60 * 60))
})

test.after(() => {
  if (prior === undefined) delete process.env.CLAIM_JWT_SECRET
  else process.env.CLAIM_JWT_SECRET = prior
})
