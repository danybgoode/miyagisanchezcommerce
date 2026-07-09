import { expect, test } from '@playwright/test'
import {
  resolveAnnouncementStatus,
  resolveActiveAnnouncement,
  decideActivationConflict,
  type AnnouncementRow,
} from '../lib/announcements-merge'

/**
 * Pure-seam coverage for the announcement primitive (epic 08 ·
 * admin-content-and-announcements, Sprint 3). No browser, no network — proves the
 * schedule/status resolution and the one-active-per-audience decision
 * `lib/announcements.ts` / `app/api/admin/announcements/route.ts` compose.
 */

const NOW = Date.parse('2026-07-09T12:00:00Z')

function row(overrides: Partial<AnnouncementRow>): AnnouncementRow {
  return {
    id: 'a1',
    audience: 'seller',
    text: 'Campaña',
    ctaLabel: null,
    ctaLink: null,
    startsAt: null,
    endsAt: null,
    active: true,
    ...overrides,
  }
}

test.describe('resolveAnnouncementStatus', () => {
  test('inactive is always inactivo, regardless of schedule', () => {
    expect(resolveAnnouncementStatus(row({ active: false, startsAt: '2026-01-01T00:00:00Z' }), NOW)).toBe('inactivo')
  })

  test('active with no schedule bounds is activo', () => {
    expect(resolveAnnouncementStatus(row({}), NOW)).toBe('activo')
  })

  test('active with a future startsAt is programado', () => {
    expect(resolveAnnouncementStatus(row({ startsAt: '2026-08-01T00:00:00Z' }), NOW)).toBe('programado')
  })

  test('active with a past endsAt is expirado', () => {
    expect(resolveAnnouncementStatus(row({ endsAt: '2026-06-01T00:00:00Z' }), NOW)).toBe('expirado')
  })

  test('active within [startsAt, endsAt) is activo', () => {
    expect(
      resolveAnnouncementStatus(row({ startsAt: '2026-07-01T00:00:00Z', endsAt: '2026-08-01T00:00:00Z' }), NOW),
    ).toBe('activo')
  })

  test('endsAt is exclusive — exactly at endsAt is expirado', () => {
    expect(resolveAnnouncementStatus(row({ endsAt: '2026-07-09T12:00:00Z' }), NOW)).toBe('expirado')
  })
})

test.describe('resolveActiveAnnouncement', () => {
  test('returns the one live row for the given audience', () => {
    const rows = [
      row({ id: 'seller-1', audience: 'seller' }),
      row({ id: 'buyer-1', audience: 'buyer' }),
    ]
    expect(resolveActiveAnnouncement(rows, 'seller', NOW)?.id).toBe('seller-1')
    expect(resolveActiveAnnouncement(rows, 'buyer', NOW)?.id).toBe('buyer-1')
  })

  test('returns null when nothing is active for that audience', () => {
    const rows = [row({ id: 'seller-1', audience: 'seller', active: false })]
    expect(resolveActiveAnnouncement(rows, 'seller', NOW)).toBeNull()
  })

  test('a programado (future) or expirado row never resolves as active', () => {
    const rows = [
      row({ id: 'future', audience: 'seller', startsAt: '2027-01-01T00:00:00Z' }),
      row({ id: 'past', audience: 'seller', endsAt: '2026-01-01T00:00:00Z' }),
    ]
    expect(resolveActiveAnnouncement(rows, 'seller', NOW)).toBeNull()
  })

  test('audience is scoped — a buyer row never resolves for seller', () => {
    const rows = [row({ id: 'buyer-1', audience: 'buyer' })]
    expect(resolveActiveAnnouncement(rows, 'seller', NOW)).toBeNull()
  })
})

test.describe('decideActivationConflict — one-active-per-audience', () => {
  test('an inactive write never conflicts, regardless of existing rows', () => {
    const rows = [row({ id: 'existing', audience: 'seller' })]
    const decision = decideActivationConflict(rows, 'seller', { active: false })
    expect(decision).toEqual({ ok: true, deactivateId: null })
  })

  test('activating with no existing active row for that audience is a clean apply', () => {
    const rows = [row({ id: 'other-audience', audience: 'buyer' })]
    const decision = decideActivationConflict(rows, 'seller', { active: true })
    expect(decision).toEqual({ ok: true, deactivateId: null })
  })

  test('activating while another campaign is active for the same audience conflicts by default', () => {
    const existing = row({ id: 'existing', audience: 'seller' })
    const decision = decideActivationConflict([existing], 'seller', { active: true })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.conflict.id).toBe('existing')
  })

  test('replaceExisting: true deactivates the conflicting row and applies', () => {
    const existing = row({ id: 'existing', audience: 'seller' })
    const decision = decideActivationConflict([existing], 'seller', { active: true, replaceExisting: true })
    expect(decision).toEqual({ ok: true, deactivateId: 'existing' })
  })

  test('editing the SAME row (excludeId) never conflicts with itself', () => {
    const existing = row({ id: 'self', audience: 'seller' })
    const decision = decideActivationConflict([existing], 'seller', { active: true, excludeId: 'self' })
    expect(decision).toEqual({ ok: true, deactivateId: null })
  })
})
