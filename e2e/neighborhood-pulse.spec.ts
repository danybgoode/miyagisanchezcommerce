import { expect, test } from '@playwright/test'
import {
  buildPrintSocialAdminPatch,
  isNeighborhoodPulseSocialItem,
} from '../lib/neighborhood-pulse'

test.describe('neighborhood pulse · moderator web opt-in', () => {
  test('admin social PATCH remains secret-gated', async ({ request }) => {
    const res = await request.patch('/api/admin/print/social/smoke-id', {
      data: { web_visible: true },
    })

    expect(res.status()).toBe(401)
  })

  test('admin patch contract accepts only boolean web_visible', () => {
    expect(buildPrintSocialAdminPatch({ web_visible: true })).toEqual({
      ok: true,
      patch: { web_visible: true },
    })
    expect(buildPrintSocialAdminPatch({ web_visible: false })).toEqual({
      ok: true,
      patch: { web_visible: false },
    })
    expect(buildPrintSocialAdminPatch({ web_visible: 'true' })).toEqual({
      ok: false,
      error: 'Invalid web_visible',
    })
  })

  test('missing or null web_visible is hidden by default', () => {
    expect(isNeighborhoodPulseSocialItem({ status: 'approved' })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: null })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: false })).toBe(false)
    expect(isNeighborhoodPulseSocialItem({ status: 'approved', web_visible: true })).toBe(true)
  })

  test('secret-gated smoke proves DB default off and PATCH on/off', async ({ request }) => {
    const secret = process.env.NEIGHBORHOOD_PULSE_SMOKE_SECRET
    test.skip(!secret, 'Set NEIGHBORHOOD_PULSE_SMOKE_SECRET to run the mutating Neighborhood Pulse smoke.')

    const res = await request.post('/api/internal/neighborhood-pulse/smoke', {
      headers: { 'x-neighborhood-pulse-test-secret': secret! },
    })
    expect(res.ok()).toBeTruthy()

    const data = await res.json() as {
      default_off: boolean
      toggled_on: boolean
      toggled_off: boolean
      status_after_toggle: string | null
    }

    expect(data.default_off).toBe(true)
    expect(data.toggled_on).toBe(true)
    expect(data.toggled_off).toBe(true)
    expect(data.status_after_toggle).toBe('approved')
  })
})
