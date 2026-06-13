import { test, expect } from '@playwright/test'
import { shouldHideTabBar, nextTabBarHidden, LABEL_MODE } from '../lib/tabbar-visibility'

/**
 * PWA bottom-bar visibility — pure logic (api gate, no browser). The MobileTabBar
 * island reads these, so the route-hide rules and the hide-on-scroll decision
 * can't drift between component and test.
 */
test.describe('tabbar · shouldHideTabBar', () => {
  test('hides on full-screen detail/flow surfaces', () => {
    expect(shouldHideTabBar('/l/abc123')).toBe(true)      // PDP
    expect(shouldHideTabBar('/checkout')).toBe(true)
    expect(shouldHideTabBar('/checkout/bundle')).toBe(true)
    expect(shouldHideTabBar('/messages/conv_42')).toBe(true) // open conversation
    expect(shouldHideTabBar('/sell')).toBe(true)
    expect(shouldHideTabBar('/sell/edit')).toBe(true)
  })

  test('stays visible on index routes and the rest of the app', () => {
    expect(shouldHideTabBar('/')).toBe(false)
    expect(shouldHideTabBar('/l')).toBe(false)            // listings index ≠ PDP
    expect(shouldHideTabBar('/l/')).toBe(false)           // trailing slash, no id
    expect(shouldHideTabBar('/messages')).toBe(false)     // inbox ≠ a conversation
    expect(shouldHideTabBar('/account')).toBe(false)
    expect(shouldHideTabBar('/account/favorites')).toBe(false)
    expect(shouldHideTabBar('/vecindario')).toBe(false)
    expect(shouldHideTabBar('')).toBe(false)
  })

  test('does not match unrelated routes that merely share a prefix', () => {
    expect(shouldHideTabBar('/selling-guide')).toBe(false) // not /sell or /sell/
    expect(shouldHideTabBar('/checkout-help')).toBe(false)
  })
})

test.describe('tabbar · nextTabBarHidden', () => {
  test('always shows near the top of the page', () => {
    expect(nextTabBarHidden(0, 0, false)).toBe(false)
    expect(nextTabBarHidden(0, 8, true)).toBe(false)   // y ≤ threshold → show
  })

  test('hides when scrolling down past the 8px delta', () => {
    expect(nextTabBarHidden(100, 120, false)).toBe(true)
  })

  test('springs back on any upward scroll', () => {
    expect(nextTabBarHidden(300, 280, true)).toBe(false)
  })

  test('sub-threshold jitter leaves the state unchanged', () => {
    expect(nextTabBarHidden(100, 105, false)).toBe(false) // +5 < 8 → unchanged
    expect(nextTabBarHidden(100, 105, true)).toBe(true)
  })
})

test.describe('tabbar · LABEL_MODE', () => {
  test('defaults to icons-only', () => {
    expect(LABEL_MODE).toBe('icons-only')
  })
})
