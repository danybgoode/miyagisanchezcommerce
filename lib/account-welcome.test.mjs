import test from 'node:test'
import assert from 'node:assert/strict'
import { verifiedWelcomeEmail } from './account-welcome.ts'

test('welcome waits for a valid verified Clerk address', () => {
  assert.equal(verifiedWelcomeEmail([{ email_address: 'owner@example.com', verification: { status: 'unverified' } }]), null)
  assert.equal(verifiedWelcomeEmail([{ email_address: 'not-an-email', verification: { status: 'verified' } }]), null)
  assert.equal(verifiedWelcomeEmail([
    { email_address: 'unverified@example.com', verification: { status: 'unverified' } },
    { email_address: ' Owner@Example.com ', verification: { status: 'verified' } },
  ]), 'owner@example.com')
})
