import { test, expect } from '@playwright/test'
import { nextOpenTask, isOverdue, isMissingAction, ageInStageDays, hasBlocker } from '../lib/relationship-pipeline'

/**
 * Founding merchant activation operations · Sprint 2, Stories 2.2/2.3 (api
 * project, network-free): the pure computations behind "next action or a
 * visible warning", overdue, age-in-stage and the admin blocker filter.
 * Zero-import, same convention as `e2e/merchant-stage.spec.ts`.
 */

const NOW = new Date('2026-07-22T12:00:00.000Z')

test.describe('nextOpenTask — earliest-due open task wins; undated is a fallback, not preferred', () => {
  test('no open tasks → null (the "sin próxima acción" condition)', () => {
    expect(nextOpenTask([])).toBeNull()
  })

  test('one dated task → itself', () => {
    const t = { id: 't1', dueAt: '2026-08-01T00:00:00.000Z' }
    expect(nextOpenTask([t])).toEqual(t)
  })

  test('two dated tasks → the earlier due date wins regardless of array order', () => {
    const later = { id: 't-later', dueAt: '2026-08-10T00:00:00.000Z' }
    const earlier = { id: 't-earlier', dueAt: '2026-08-01T00:00:00.000Z' }
    expect(nextOpenTask([later, earlier])).toEqual(earlier)
    expect(nextOpenTask([earlier, later])).toEqual(earlier)
  })

  test('a dated task is preferred over an undated one, even if the undated one is first in the array', () => {
    const undated = { id: 't-undated', dueAt: null }
    const dated = { id: 't-dated', dueAt: '2026-09-01T00:00:00.000Z' }
    expect(nextOpenTask([undated, dated])).toEqual(dated)
  })

  test('only undated tasks exist → the first one is returned (still "some" next action)', () => {
    const undated = { id: 't-undated', dueAt: null }
    expect(nextOpenTask([undated])).toEqual(undated)
  })
})

test.describe('isMissingAction — the exact "every active merchant is scheduled or visibly missing" predicate', () => {
  test('empty open-task list → true', () => {
    expect(isMissingAction([])).toBe(true)
  })
  test('any open task at all, dated or not → false', () => {
    expect(isMissingAction([{ id: 't1', dueAt: null }])).toBe(false)
  })
})

test.describe('isOverdue — only a DATED open task whose date has passed', () => {
  test('no task at all → not overdue', () => {
    expect(isOverdue(null, NOW)).toBe(false)
  })
  test('undated open task → never overdue (nothing to be late against)', () => {
    expect(isOverdue({ id: 't1', dueAt: null }, NOW)).toBe(false)
  })
  test('due date in the past → overdue', () => {
    expect(isOverdue({ id: 't1', dueAt: '2026-07-01T00:00:00.000Z' }, NOW)).toBe(true)
  })
  test('due date in the future → not overdue', () => {
    expect(isOverdue({ id: 't1', dueAt: '2026-08-01T00:00:00.000Z' }, NOW)).toBe(false)
  })
  test('due date exactly now → not overdue (strict less-than)', () => {
    expect(isOverdue({ id: 't1', dueAt: NOW.toISOString() }, NOW)).toBe(false)
  })
})

test.describe('ageInStageDays — whole days, floors at 0', () => {
  test('entered exactly 3 days ago → 3', () => {
    const enteredAt = new Date(NOW.getTime() - 3 * 86_400_000).toISOString()
    expect(ageInStageDays(enteredAt, NOW)).toBe(3)
  })
  test('entered less than a day ago → 0', () => {
    const enteredAt = new Date(NOW.getTime() - 3600_000).toISOString()
    expect(ageInStageDays(enteredAt, NOW)).toBe(0)
  })
  test('entered "in the future" (clock skew) → 0, never negative', () => {
    const enteredAt = new Date(NOW.getTime() + 86_400_000).toISOString()
    expect(ageInStageDays(enteredAt, NOW)).toBe(0)
  })
})

test.describe('hasBlocker — the documented, revisable choice: a non-blank objections note', () => {
  test('null → false', () => expect(hasBlocker(null)).toBe(false))
  test('empty string → false', () => expect(hasBlocker('')).toBe(false))
  test('whitespace-only → false', () => expect(hasBlocker('   ')).toBe(false))
  test('a real objection → true', () => expect(hasBlocker('Dice que no tiene tiempo esta semana.')).toBe(true))
})
