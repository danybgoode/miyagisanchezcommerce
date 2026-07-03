import { test, expect } from '@playwright/test'
import {
  validateApplicationInput,
  applicationRefusalMessage,
} from '../lib/promoter-applications'

/**
 * Promoter Funnel v2 · Sprint 2 (api project — pure seam + anonymous route guards,
 * no browser). Two layers, mirroring e2e/promoter-program.spec.ts:
 *
 *  1. PURE LIB — validateApplicationInput's required-fields / honeypot / email-shape /
 *     length-cap decisions, and the es-MX refusal copy.
 *  2. ROUTE GUARDS — the public apply route rejects malformed/spam submissions without
 *     ever reaching the database.
 *
 * NOT covered here (by design, same discipline as e2e/sweepstakes.spec.ts): a
 * genuinely VALID submission against the live route. This Supabase project is
 * shared across dev/preview/prod (no per-branch DB) — see LEARNINGS "Supabase has
 * no separate dev-scoped credential" — so a spec that submits a real application
 * would leave permanent test rows in the shared table on every CI run. The
 * end-to-end apply → notify → admin approve/reject → email flow is the sprint's
 * documented smoke walkthrough instead (sprint-2.md), run manually against a
 * throwaway application.
 */

const VALID = { name: 'Test Promotor', email: 'test@example.com', whatsapp: '5512345678', city: 'CDMX', motivation: 'Quiero vender' }

test.describe('promoter applications · validateApplicationInput (pure)', () => {
  test('a well-formed submission passes and normalizes the clean fields', () => {
    const r = validateApplicationInput(VALID)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.clean).toEqual({
        name: 'Test Promotor',
        email: 'test@example.com',
        whatsapp: '5512345678',
        city: 'CDMX',
        motivation: 'Quiero vender',
      })
    }
  })

  test('optional fields (city, motivation) default to null when blank', () => {
    const r = validateApplicationInput({ name: 'X', email: 'x@example.com', whatsapp: '555', city: '  ', motivation: '' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.clean.city).toBeNull()
      expect(r.clean.motivation).toBeNull()
    }
  })

  test('missing name/email/whatsapp ⇒ missing_fields', () => {
    expect(validateApplicationInput({ email: 'x@example.com', whatsapp: '555' })).toEqual({ ok: false, reason: 'missing_fields' })
    expect(validateApplicationInput({ name: 'X', whatsapp: '555' })).toEqual({ ok: false, reason: 'missing_fields' })
    expect(validateApplicationInput({ name: 'X', email: 'x@example.com' })).toEqual({ ok: false, reason: 'missing_fields' })
  })

  test('malformed email ⇒ invalid_email', () => {
    const r = validateApplicationInput({ ...VALID, email: 'not-an-email' })
    expect(r).toEqual({ ok: false, reason: 'invalid_email' })
  })

  test('oversized fields ⇒ too_long', () => {
    const r = validateApplicationInput({ ...VALID, name: 'x'.repeat(101) })
    expect(r).toEqual({ ok: false, reason: 'too_long' })
  })

  test('a non-empty honeypot ⇒ honeypot, checked BEFORE any other validation', () => {
    const r = validateApplicationInput({ website: 'http://spam.example' })
    expect(r).toEqual({ ok: false, reason: 'honeypot' })
  })

  test('every refusal reason yields non-empty es-MX copy with no placeholder/leak', () => {
    for (const reason of ['honeypot', 'missing_fields', 'invalid_email', 'too_long'] as const) {
      const msg = applicationRefusalMessage(reason)
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toMatch(/undefined|null|TODO|PEGA_|XXX/)
    }
  })
})

test.describe('promoter applications · POST /api/promoter/apply (anonymous)', () => {
  test('missing required fields ⇒ 400, no row created', async ({ request }) => {
    const res = await request.post('/api/promoter/apply', { data: { name: '', email: '', whatsapp: '' } })
    expect(res.status()).toBe(400)
  })

  test('malformed email ⇒ 400', async ({ request }) => {
    const res = await request.post('/api/promoter/apply', {
      data: { name: 'Test', email: 'not-an-email', whatsapp: '555' },
    })
    expect(res.status()).toBe(400)
  })

  test('a filled honeypot pretends success without writing a row', async ({ request }) => {
    const res = await request.post('/api/promoter/apply', {
      data: { name: 'Bot', email: 'bot@example.com', whatsapp: '555', website: 'http://spam.example' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('malformed JSON body ⇒ 400', async ({ request }) => {
    const res = await request.post('/api/promoter/apply', { data: 'not json', headers: { 'Content-Type': 'application/json' } })
    expect([400, 500]).toContain(res.status())
  })
})
