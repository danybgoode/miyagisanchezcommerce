import { expect, test } from '@playwright/test'
import {
  NAV_PROGRESS_CEILING,
  navProgressWidth,
  shouldStartNavProgress,
  type NavClickDescriptor,
} from '../lib/nav-progress'

/**
 * The pure decision layer behind the route progress bar.
 *
 * Every case below is a false positive that would otherwise ship: a bar that
 * appears for a navigation that is never going to happen sits there until its
 * own timeout, which teaches people the bar means nothing — strictly worse than
 * having no bar at all.
 */

const base: NavClickDescriptor = {
  href: '/mx/l/prod_123',
  currentOrigin: 'https://miyagisanchez.com',
  currentPath: '/mx',
  button: 0,
}

test.describe('shouldStartNavProgress', () => {
  test('a plain same-origin click to another path starts it', () => {
    expect(shouldStartNavProgress(base)).toBe(true)
  })

  test('an absolute same-origin href starts it too', () => {
    expect(shouldStartNavProgress({ ...base, href: 'https://miyagisanchez.com/mx/l/prod_123' })).toBe(true)
  })

  test('a click that hit no anchor does not start it', () => {
    expect(shouldStartNavProgress({ ...base, href: null })).toBe(false)
  })

  test('modifier clicks open a new tab — the current page is not navigating', () => {
    expect(shouldStartNavProgress({ ...base, metaKey: true })).toBe(false)
    expect(shouldStartNavProgress({ ...base, ctrlKey: true })).toBe(false)
    expect(shouldStartNavProgress({ ...base, shiftKey: true })).toBe(false)
    expect(shouldStartNavProgress({ ...base, altKey: true })).toBe(false)
  })

  test('a middle or right click is not a navigation', () => {
    expect(shouldStartNavProgress({ ...base, button: 1 })).toBe(false)
    expect(shouldStartNavProgress({ ...base, button: 2 })).toBe(false)
  })

  test('target=_blank leaves this tab where it is', () => {
    expect(shouldStartNavProgress({ ...base, target: '_blank' })).toBe(false)
    // …but an explicit `_self` IS this tab — the negation of what we ban.
    expect(shouldStartNavProgress({ ...base, target: '_self' })).toBe(true)
  })

  test('a download link never navigates', () => {
    expect(shouldStartNavProgress({ ...base, download: true })).toBe(false)
  })

  test('cross-origin, mailto and tel are the browser’s business, not the router’s', () => {
    expect(shouldStartNavProgress({ ...base, href: 'https://stripe.com/x' })).toBe(false)
    expect(shouldStartNavProgress({ ...base, href: 'mailto:hola@miyagisanchez.com' })).toBe(false)
    expect(shouldStartNavProgress({ ...base, href: 'tel:+525555555555' })).toBe(false)
  })

  test('a link to the page you are already on loads nothing', () => {
    expect(shouldStartNavProgress({ ...base, href: '/mx' })).toBe(false)
    expect(shouldStartNavProgress({ ...base, href: '#seccion' })).toBe(false)
  })

  test('the same path with a DIFFERENT query does navigate (filters, pagination)', () => {
    // The catalog pages the bar matters most for change only their query string.
    expect(shouldStartNavProgress({ ...base, href: '/mx?page=2' })).toBe(true)
  })

  test('an already-prevented event has been handled by something else', () => {
    expect(shouldStartNavProgress({ ...base, defaultPrevented: true })).toBe(false)
  })

  test('a javascript: href is refused rather than thrown on', () => {
    expect(shouldStartNavProgress({ ...base, href: 'javascript:void(0)' })).toBe(false)
  })

  test('a RELATIVE href resolves against the current PAGE, not the bare origin', () => {
    // The bug this pins: resolving `#seccion` against the origin alone yields
    // pathname `/`, which reads as "navigating away from /mx" and started the
    // bar for what is only a scroll.
    expect(shouldStartNavProgress({ ...base, href: '#seccion', currentPath: '/mx' })).toBe(false)
    expect(shouldStartNavProgress({ ...base, href: './l', currentPath: '/mx/' })).toBe(true)
  })
})

test.describe('navProgressWidth', () => {
  test('starts at zero and grows monotonically', () => {
    expect(navProgressWidth(0)).toBe(0)
    const samples = [100, 300, 600, 1200, 3000, 10_000].map(navProgressWidth)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
    }
  })

  test('NEVER reaches 100 on its own — the bar must not claim an arrival it cannot know about', () => {
    for (const ms of [1_000, 10_000, 60_000, 600_000]) {
      expect(navProgressWidth(ms)).toBeLessThanOrEqual(NAV_PROGRESS_CEILING)
    }
    expect(navProgressWidth(600_000)).toBeLessThan(100)
  })

  test('is visibly moving early — a bar that sits at 1% reads as frozen', () => {
    expect(navProgressWidth(300)).toBeGreaterThan(10)
  })

  test('is deterministic, so it can be asserted at all', () => {
    expect(navProgressWidth(500)).toBe(navProgressWidth(500))
  })
})
