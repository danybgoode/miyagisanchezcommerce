import { test, expect } from '@playwright/test'
import {
  isValidStudioTransition,
  isValidStudioSocialTransition,
  toStudioSafeSocialSubmission,
  type PrintSocialSubmission,
} from '../lib/print'

/**
 * Print-studio API · auth gate + narrow-transition guardrail (epic
 * zine-editing-central, Story 1.2 — HIGH risk: new machine-auth surface +
 * advertiser-facing status write-back).
 *
 * `/api/admin/print/studio/*` is `withPrintStudio`-gated (Clerk admin OR a
 * `PRINT_STUDIO_TOKEN` Bearer token); the `api` project runs ANONYMOUS, so
 * every route must 401 with no header, and a wrong Bearer value must ALSO
 * 401 (proves the token is actually checked, not just its presence). The
 * pure `isValidStudioTransition` truth table needs no network. The real
 * round-trip (flip a disposable submission approved→placed→approved with a
 * valid token) only runs when `PRINT_STUDIO_TOKEN` + `MS_TEST_PRINT_STUDIO_SUBMISSION_ID`
 * are set as env — until then it skips with a clear reason (owed to Daniel,
 * one-time provisioning, same pattern as the other `MS_TEST_*` fixtures).
 */

const JUNK_BEARER = { Authorization: 'Bearer not-a-real-token' }

test.describe('print-studio API · anonymous is rejected', () => {
  test('GET .../studio/editions → 401 (no auth)', async ({ request }) => {
    const res = await request.get('/api/admin/print/studio/editions')
    expect(res.status()).toBe(401)
  })

  test('GET .../studio/editions/:id/submissions → 401 (no auth)', async ({ request }) => {
    const res = await request.get('/api/admin/print/studio/editions/does-not-exist/submissions')
    expect(res.status()).toBe(401)
  })

  test('GET .../studio/social → 401 (no auth)', async ({ request }) => {
    const res = await request.get('/api/admin/print/studio/social')
    expect(res.status()).toBe(401)
  })

  test('GET .../studio/catalog → 401 (no auth)', async ({ request }) => {
    const res = await request.get('/api/admin/print/studio/catalog?q=test')
    expect(res.status()).toBe(401)
  })

  test('PATCH .../studio/submissions/:id → 401 (no auth)', async ({ request }) => {
    const res = await request.patch('/api/admin/print/studio/submissions/does-not-exist', {
      data: { status: 'placed' },
    })
    expect(res.status()).toBe(401)
  })

  test('PATCH .../studio/social/:id → 401 (no auth)', async ({ request }) => {
    const res = await request.patch('/api/admin/print/studio/social/does-not-exist', {
      data: { status: 'placed' },
    })
    expect(res.status()).toBe(401)
  })
})

test.describe('print-studio API · a wrong Bearer token is rejected', () => {
  test('GET .../studio/editions with a junk token → still 401', async ({ request }) => {
    const res = await request.get('/api/admin/print/studio/editions', { headers: JUNK_BEARER })
    expect(res.status()).toBe(401)
  })

  test('PATCH .../studio/submissions/:id with a junk token → still 401', async ({ request }) => {
    const res = await request.patch('/api/admin/print/studio/submissions/does-not-exist', {
      headers: JUNK_BEARER,
      data: { status: 'placed' },
    })
    expect(res.status()).toBe(401)
  })

  test('PATCH .../studio/social/:id with a junk token → still 401', async ({ request }) => {
    const res = await request.patch('/api/admin/print/studio/social/does-not-exist', {
      headers: JUNK_BEARER,
      data: { status: 'placed' },
    })
    expect(res.status()).toBe(401)
  })
})

test.describe('isValidStudioTransition — the narrow write-back rule (pure)', () => {
  test('approved ⇄ placed are the only allowed pair', () => {
    expect(isValidStudioTransition('approved', 'placed')).toBe(true)
    expect(isValidStudioTransition('placed', 'approved')).toBe(true)
  })

  test('everything money-adjacent stays out of reach', () => {
    expect(isValidStudioTransition('paid', 'approved')).toBe(false)
    expect(isValidStudioTransition('approved', 'refunded')).toBe(false)
    expect(isValidStudioTransition('placed', 'rejected')).toBe(false)
    expect(isValidStudioTransition('draft', 'placed')).toBe(false)
    expect(isValidStudioTransition('approved', 'approved')).toBe(false)
  })
})

test.describe('isValidStudioSocialTransition — the same narrow rule for social submissions (pure)', () => {
  test('approved ⇄ placed are the only allowed pair', () => {
    expect(isValidStudioSocialTransition('approved', 'placed')).toBe(true)
    expect(isValidStudioSocialTransition('placed', 'approved')).toBe(true)
  })

  test('submitted/rejected stay out of reach on either side', () => {
    expect(isValidStudioSocialTransition('submitted', 'approved')).toBe(false)
    expect(isValidStudioSocialTransition('approved', 'rejected')).toBe(false)
    expect(isValidStudioSocialTransition('placed', 'rejected')).toBe(false)
    expect(isValidStudioSocialTransition('submitted', 'placed')).toBe(false)
    expect(isValidStudioSocialTransition('approved', 'approved')).toBe(false)
  })
})

test.describe('toStudioSafeSocialSubmission — PII-safe projection (pure)', () => {
  test('strips submitter email/Clerk id and moderator-only fields, keeps layout-relevant ones', () => {
    const row: PrintSocialSubmission = {
      id: 'sub-1',
      edition_id: 'ed-1',
      submitter_clerk_user_id: 'user_abc123',
      submitter_name: 'Dona Chela',
      submitter_email: 'chela@example.com',
      type: 'recomendacion',
      caption: 'El taller de bicis',
      body: 'Arreglan cualquier cosa.',
      photos: ['https://example.com/a.jpg'],
      zone: 'Palmas',
      web_visible: true,
      status: 'approved',
      source: 'community',
      admin_notes: 'internal note nobody outside admin should see',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    }

    const safe = toStudioSafeSocialSubmission(row)

    expect(safe).not.toHaveProperty('submitter_email')
    expect(safe).not.toHaveProperty('submitter_clerk_user_id')
    expect(safe).not.toHaveProperty('admin_notes')
    expect(safe).not.toHaveProperty('web_visible')
    expect(safe).not.toHaveProperty('updated_at')

    expect(safe).toEqual({
      id: 'sub-1',
      edition_id: 'ed-1',
      submitter_name: 'Dona Chela',
      type: 'recomendacion',
      caption: 'El taller de bicis',
      body: 'Arreglan cualquier cosa.',
      photos: ['https://example.com/a.jpg'],
      zone: 'Palmas',
      status: 'approved',
      source: 'community',
      created_at: '2026-01-01T00:00:00Z',
    })
  })
})

test.describe('print-studio API · authed round-trip (owed provisioning)', () => {
  const token = process.env.PRINT_STUDIO_TOKEN
  const submissionId = process.env.MS_TEST_PRINT_STUDIO_SUBMISSION_ID

  test('flips a disposable submission approved → placed → approved', async ({ request }) => {
    test.skip(!token, 'Set PRINT_STUDIO_TOKEN to run the authed round-trip.')
    test.skip(!submissionId, 'Set MS_TEST_PRINT_STUDIO_SUBMISSION_ID (a disposable approved submission) to run the authed round-trip.')

    const auth = { Authorization: `Bearer ${token}` }

    const toPlaced = await request.patch(`/api/admin/print/studio/submissions/${submissionId}`, {
      headers: auth,
      data: { status: 'placed' },
    })
    expect(toPlaced.ok()).toBeTruthy()
    expect((await toPlaced.json()).submission.status).toBe('placed')

    const back = await request.patch(`/api/admin/print/studio/submissions/${submissionId}`, {
      headers: auth,
      data: { status: 'approved' },
    })
    expect(back.ok()).toBeTruthy()
    expect((await back.json()).submission.status).toBe('approved')
  })

  const socialId = process.env.MS_TEST_PRINT_STUDIO_SOCIAL_ID
  const socialEditionId = process.env.MS_TEST_PRINT_STUDIO_EDITION_ID

  test('flips a disposable social submission approved → placed → approved, scoped to an edition', async ({ request }) => {
    test.skip(!token, 'Set PRINT_STUDIO_TOKEN to run the authed round-trip.')
    test.skip(!socialId, 'Set MS_TEST_PRINT_STUDIO_SOCIAL_ID (a disposable approved social submission) to run the authed round-trip.')
    test.skip(!socialEditionId, 'Set MS_TEST_PRINT_STUDIO_EDITION_ID (a real print_editions UUID) — placing now requires one.')

    const auth = { Authorization: `Bearer ${token}` }

    const toPlaced = await request.patch(`/api/admin/print/studio/social/${socialId}`, {
      headers: auth,
      data: { status: 'placed', editionId: socialEditionId },
    })
    expect(toPlaced.ok()).toBeTruthy()
    expect((await toPlaced.json()).submission.status).toBe('placed')

    const back = await request.patch(`/api/admin/print/studio/social/${socialId}`, {
      headers: auth,
      data: { status: 'approved' },
    })
    expect(back.ok()).toBeTruthy()
    expect((await back.json()).submission.status).toBe('approved')
  })

  test('PATCH .../studio/social/:id with status=placed and no editionId → 400', async ({ request }) => {
    test.skip(!token, 'Set PRINT_STUDIO_TOKEN to run the authed round-trip.')
    test.skip(!socialId, 'Set MS_TEST_PRINT_STUDIO_SOCIAL_ID to run this check.')

    const res = await request.patch(`/api/admin/print/studio/social/${socialId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'placed' },
    })
    expect(res.status()).toBe(400)
  })

  test('GET .../studio/social?editionId=<non-uuid> → 400 (not silently ignored or passed to the DB filter)', async ({ request }) => {
    test.skip(!token, 'Set PRINT_STUDIO_TOKEN to run the authed round-trip.')

    const res = await request.get('/api/admin/print/studio/social?editionId=not-a-uuid,edition_id.is.null', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH .../studio/social/:id with a JSON `null` body → 400, not a 500 (was throwing on body.status)', async ({ request }) => {
    test.skip(!token, 'Set PRINT_STUDIO_TOKEN to run the authed round-trip.')
    test.skip(!socialId, 'Set MS_TEST_PRINT_STUDIO_SOCIAL_ID to run this check.')

    const res = await request.patch(`/api/admin/print/studio/social/${socialId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: 'null',
    })
    expect(res.status()).toBe(400)
  })
})
