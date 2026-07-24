import { test, expect } from '@playwright/test'
import {
  nextOpenTask,
  isOverdue,
  isMissingAction,
  ageInStageDays,
  hasBlocker,
  dueAtIsoFromDateOnly,
  isDateOnlyShape,
} from '../lib/relationship-pipeline'

/**
 * Founding merchant activation operations · Sprint 2, Stories 2.2/2.3 (api
 * project, network-free): the pure computations behind "next action or a
 * visible warning", overdue, age-in-stage and the admin blocker filter.
 * Zero-import, same convention as `e2e/merchant-stage.spec.ts`.
 *
 * C2 fix (PR 304 review): `nextOpenTask`/`isMissingAction` no longer treat an
 * UNDATED open task as "scheduled" — acceptance 6 requires a *dated* next
 * action or a visible warning. The old "undated is a fallback, not
 * preferred" describe block below is REPLACED (not merely amended) to assert
 * the new rule directly.
 */

const NOW = new Date('2026-07-22T12:00:00.000Z')

test.describe('nextOpenTask — a DATED open task only; undated never counts as "the next action" (C2)', () => {
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

  test('a dated task is picked even when an undated one is first in the array', () => {
    const undated = { id: 't-undated', dueAt: null }
    const dated = { id: 't-dated', dueAt: '2026-09-01T00:00:00.000Z' }
    expect(nextOpenTask([undated, dated])).toEqual(dated)
  })

  test('C2: ONLY undated tasks exist → null, not the first undated one — an undated task is never "the next action"', () => {
    const undated = { id: 't-undated', dueAt: null }
    expect(nextOpenTask([undated])).toBeNull()
    expect(nextOpenTask([undated, { id: 't-undated-2', dueAt: null }])).toBeNull()
  })
})

test.describe('isMissingAction — the exact "every active merchant is scheduled or visibly missing" predicate (C2)', () => {
  test('empty open-task list → true', () => {
    expect(isMissingAction([])).toBe(true)
  })
  test('a DATED open task → false (genuinely scheduled)', () => {
    expect(isMissingAction([{ id: 't1', dueAt: '2026-08-01T00:00:00.000Z' }])).toBe(false)
  })
  test('C2: ONLY undated open tasks → true — acceptance 6 requires a DATED next action, an undated one must still show the warning', () => {
    expect(isMissingAction([{ id: 't1', dueAt: null }])).toBe(true)
    expect(isMissingAction([{ id: 't1', dueAt: null }, { id: 't2', dueAt: null }])).toBe(true)
  })
  test('C2: one dated + one undated → false (the dated one satisfies it)', () => {
    expect(isMissingAction([{ id: 't1', dueAt: null }, { id: 't2', dueAt: '2026-08-01T00:00:00.000Z' }])).toBe(false)
  })
  test('isMissingAction and nextOpenTask never disagree, across every combination above', () => {
    const cases = [
      [],
      [{ id: 't1', dueAt: null }],
      [{ id: 't1', dueAt: '2026-08-01T00:00:00.000Z' }],
      [{ id: 't1', dueAt: null }, { id: 't2', dueAt: '2026-08-01T00:00:00.000Z' }],
    ]
    for (const tasks of cases) {
      expect(isMissingAction(tasks)).toBe(nextOpenTask(tasks) === null)
    }
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

test.describe('dueAtIsoFromDateOnly — C8: a date-only value is end-of-day AMÉRICA/MEXICO_CITY, never UTC midnight', () => {
  test('a well-formed date-only string resolves to 23:59:59.999 fixed UTC-6 (05:59:59.999 UTC the NEXT day)', () => {
    const iso = dueAtIsoFromDateOnly('2026-07-23')
    expect(iso).toBe('2026-07-24T05:59:59.999Z')
  })

  test('the WRONG interpretation (bare `new Date("2026-07-23")`, midnight UTC) would read as July 22 in es-MX — the fix must NOT produce that instant', () => {
    const iso = dueAtIsoFromDateOnly('2026-07-23')!
    const wrongInstant = new Date('2026-07-23').toISOString()
    expect(iso).not.toBe(wrongInstant)
    // And the fixed instant, rendered back in Mexico City, is still July 23 —
    // the whole point of the fix.
    const renderedMxDate = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
    expect(renderedMxDate).toBe('2026-07-23')
  })

  test('a full ISO datetime (not date-only) → null, so the caller falls back to parsing it as-is', () => {
    expect(dueAtIsoFromDateOnly('2026-07-23T10:00:00.000Z')).toBeNull()
  })

  test('garbage / empty / malformed → null', () => {
    expect(dueAtIsoFromDateOnly('')).toBeNull()
    expect(dueAtIsoFromDateOnly('not-a-date')).toBeNull()
    expect(dueAtIsoFromDateOnly('2026-13-99')).toBeNull()
    expect(dueAtIsoFromDateOnly('26-07-23')).toBeNull()
  })

  test('D3e (PR 304 review, round 3): a SHAPE-valid but CALENDAR-invalid date is rejected, not silently rolled over', () => {
    // JS's Date parser is arithmetic, not calendar-aware — it would otherwise
    // roll 2026-02-31 into a March date, exactly like Date.UTC(2026, 1, 31)
    // does. <input type="date"> can never produce these; a direct API call can.
    expect(dueAtIsoFromDateOnly('2026-02-31')).toBeNull() // February never has 31 days
    expect(dueAtIsoFromDateOnly('2026-02-30')).toBeNull() // nor 30
    expect(dueAtIsoFromDateOnly('2026-04-31')).toBeNull() // April has 30
    expect(dueAtIsoFromDateOnly('2026-00-15')).toBeNull() // month 0 doesn't exist
    expect(dueAtIsoFromDateOnly('2026-07-00')).toBeNull() // day 0 doesn't exist
  })

  test('D3e: the boundary cases just past the rejected ones are genuinely valid, so the round-trip check is not over-strict', () => {
    expect(dueAtIsoFromDateOnly('2026-02-28')).not.toBeNull() // 2026 is not a leap year
    expect(dueAtIsoFromDateOnly('2026-04-30')).not.toBeNull()
    expect(dueAtIsoFromDateOnly('2024-02-29')).not.toBeNull() // 2024 IS a leap year
  })

  test('D3e: a leap-day claim in a NON-leap year is rejected', () => {
    expect(dueAtIsoFromDateOnly('2026-02-29')).toBeNull() // 2026 is not a leap year
  })
})

test.describe('isDateOnlyShape — D3e: distinguishing "date-only but invalid" from "not date-only at all"', () => {
  test('a well-formed date-only string → true', () => {
    expect(isDateOnlyShape('2026-07-23')).toBe(true)
  })
  test('a SHAPE-valid but calendar-invalid date is STILL shape-true — the caller must reject it explicitly, not silently fall back to generic parsing', () => {
    expect(isDateOnlyShape('2026-02-31')).toBe(true)
  })
  test('a full ISO datetime → false (the caller should parse it generically, not via the date-only path)', () => {
    expect(isDateOnlyShape('2026-07-23T10:00:00.000Z')).toBe(false)
  })
  test('garbage / empty → false', () => {
    expect(isDateOnlyShape('')).toBe(false)
    expect(isDateOnlyShape('not-a-date')).toBe(false)
    expect(isDateOnlyShape('26-07-23')).toBe(false)
  })
})
