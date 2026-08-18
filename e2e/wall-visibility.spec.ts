import { test, expect } from '@playwright/test'
import {
  effectiveInstant,
  isPubliclyVisible,
  orderPublicWall,
  canTransition,
  nextPublishedAt,
  paginate,
} from '../lib/wall/visibility'
import { WALL_PAGE_SIZE } from '../lib/wall/validate'

/**
 * Living Shop · Sprint 1 — Wall visibility and ordering (Stories 1.1 + 1.2).
 *
 * `now` is injected, so the schedule boundary is a function call rather than a
 * sleep — the whole point of keeping this half pure.
 *
 * Observed red by inverting the pin lift in `orderPublicWall` (the pinned-first
 * case failed) and by making `nextPublishedAt` always stamp `now` (the
 * republish-keeps-its-date case failed).
 */

const AT = (iso: string) => Date.parse(iso)
const NOW = new Date('2026-08-18T12:00:00.000Z')

const entry = (over: Partial<{
  id: string; status: 'draft' | 'published' | 'scheduled'
  published_at: string | null; scheduled_for: string | null; pinned: boolean
}>) => ({
  id: 'e1',
  status: 'published' as const,
  published_at: '2026-08-18T10:00:00.000Z',
  scheduled_for: null as string | null,
  pinned: false,
  ...over,
})

test.describe('wall visibility · the schedule boundary', () => {
  test('a draft is never visible, however old', () => {
    expect(isPubliclyVisible(entry({ status: 'draft', published_at: null }), NOW)).toBe(false)
  })

  test('a published entry is visible', () => {
    expect(isPubliclyVisible(entry({}), NOW)).toBe(true)
  })

  test('a scheduled entry is hidden BEFORE its instant and visible AFTER — no cron involved', () => {
    const scheduled = entry({ status: 'scheduled', published_at: null, scheduled_for: '2026-08-18T12:00:00.000Z' })
    expect(isPubliclyVisible(scheduled, new Date(AT('2026-08-18T11:59:59.999Z')))).toBe(false)
    expect(isPubliclyVisible(scheduled, new Date(AT('2026-08-18T12:00:00.000Z')))).toBe(true)
    expect(isPubliclyVisible(scheduled, new Date(AT('2026-08-18T12:00:00.001Z')))).toBe(true)
  })

  test('a malformed instant is not visible rather than throwing', () => {
    expect(isPubliclyVisible(entry({ published_at: 'not-a-date' }), NOW)).toBe(false)
  })

  test('the effective instant is the one that applies to the state', () => {
    expect(effectiveInstant(entry({}))).toBe('2026-08-18T10:00:00.000Z')
    expect(effectiveInstant(entry({ status: 'scheduled', published_at: null, scheduled_for: '2026-09-01T00:00:00.000Z' })))
      .toBe('2026-09-01T00:00:00.000Z')
    expect(effectiveInstant(entry({ status: 'draft', published_at: null }))).toBeNull()
  })
})

test.describe('wall visibility · ordering', () => {
  test('the pinned entry leads, the rest are newest-first', () => {
    const ordered = orderPublicWall([
      entry({ id: 'newest', published_at: '2026-08-18T11:00:00.000Z' }),
      entry({ id: 'pinned-old', published_at: '2026-08-01T09:00:00.000Z', pinned: true }),
      entry({ id: 'middle', published_at: '2026-08-10T09:00:00.000Z' }),
    ], NOW)
    expect(ordered.map((e) => e.id)).toEqual(['pinned-old', 'newest', 'middle'])
  })

  test('pinning changes prominence, not the entry own date', () => {
    const [first] = orderPublicWall([entry({ id: 'p', published_at: '2026-08-01T09:00:00.000Z', pinned: true })], NOW)
    expect(effectiveInstant(first)).toBe('2026-08-01T09:00:00.000Z')
  })

  test('invisible entries never reach the public order', () => {
    const ordered = orderPublicWall([
      entry({ id: 'draft', status: 'draft', published_at: null }),
      entry({ id: 'future', status: 'scheduled', published_at: null, scheduled_for: '2027-01-01T00:00:00.000Z' }),
      entry({ id: 'live' }),
    ], NOW)
    expect(ordered.map((e) => e.id)).toEqual(['live'])
  })

  test('a same-instant tie is broken deterministically, so a cursor cannot skip or repeat', () => {
    const a = entry({ id: 'aaa', published_at: '2026-08-18T10:00:00.000Z' })
    const b = entry({ id: 'bbb', published_at: '2026-08-18T10:00:00.000Z' })
    expect(orderPublicWall([a, b], NOW).map((e) => e.id))
      .toEqual(orderPublicWall([b, a], NOW).map((e) => e.id))
  })
})

test.describe('wall visibility · transitions', () => {
  test('every state can reach every other', () => {
    for (const from of ['draft', 'published', 'scheduled'] as const) {
      for (const to of ['draft', 'published', 'scheduled'] as const) {
        expect(canTransition(from, to)).toBe(true)
      }
    }
  })

  test('publishing stamps an instant once and keeps it across an unpublish round trip', () => {
    const first = nextPublishedAt(null, 'published', new Date('2026-08-18T10:00:00.000Z'))
    expect(first).toBe('2026-08-18T10:00:00.000Z')
    const afterUnpublish = nextPublishedAt(first, 'draft', new Date('2026-08-18T11:00:00.000Z'))
    expect(afterUnpublish).toBe(first)
    const republished = nextPublishedAt(afterUnpublish, 'published', new Date('2026-08-18T12:00:00.000Z'))
    expect(republished).toBe(first)
  })
})

test.describe('wall visibility · pagination', () => {
  const items = Array.from({ length: 30 }, (_, i) => i)

  test('the initial page is bounded', () => {
    const page = paginate(items, 0, WALL_PAGE_SIZE)
    expect(page.items).toHaveLength(WALL_PAGE_SIZE)
    expect(page.hasMore).toBe(true)
  })

  test('the last page reports no more', () => {
    const page = paginate(items, 24, WALL_PAGE_SIZE)
    expect(page.items).toHaveLength(6)
    expect(page.hasMore).toBe(false)
  })

  test('an offset past the end is empty, not an error', () => {
    expect(paginate(items, 999, WALL_PAGE_SIZE)).toEqual({ items: [], hasMore: false })
  })

  test('a negative offset clamps to the start', () => {
    expect(paginate(items, -5, 3).items).toEqual([0, 1, 2])
  })
})
