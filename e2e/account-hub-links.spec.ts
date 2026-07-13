import { test, expect } from '@playwright/test'
import { ACCOUNT_HUB_LINKS } from '../lib/account-hub-links'

/**
 * Account hub (`/account`) LINKS grid — pure logic (api gate, no browser).
 * `/account/page.tsx` renders exactly this list, so the row can't drift
 * between the component and the test. Same idiom as `account-menu.spec.ts`.
 *
 * Mobile Clerk account management — regression guard for the "Administrar
 * cuenta" row, the only discoverable entry point to Clerk's <UserProfile />
 * on mobile (the desktop CuentaMenu dropdown is hidden there).
 */
test.describe('account-hub-links · ACCOUNT_HUB_LINKS', () => {
  test('has an "Administrar cuenta" row pointing at /account/settings, near the top', () => {
    const entry = ACCOUNT_HUB_LINKS.find(l => l.href === '/account/settings')
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({
      href: '/account/settings',
      label: 'Administrar cuenta',
      icon: 'iconoir-settings',
    })
    expect(entry!.desc.length).toBeGreaterThan(0)

    // "near the top" — within the first two rows.
    const index = ACCOUNT_HUB_LINKS.findIndex(l => l.href === '/account/settings')
    expect(index).toBeLessThan(2)
  })

  test('every row has a unique href and non-empty label/desc/icon', () => {
    const hrefs = ACCOUNT_HUB_LINKS.map(l => l.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const link of ACCOUNT_HUB_LINKS) {
      expect(link.label.length).toBeGreaterThan(0)
      expect(link.desc.length).toBeGreaterThan(0)
      expect(link.icon).toMatch(/^iconoir-/)
    }
  })
})
