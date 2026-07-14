import { test, expect } from '@playwright/test'
import { ACCOUNT_MENU_ITEMS } from '../lib/account-menu'

/**
 * Cuenta hub (Nav & Settings Reorg — Sprint 2) — pure logic (api gate, no
 * browser). `CuentaMenu` renders exactly this list, so the labels + hrefs can't
 * drift between component and test. Same idiom as `tabbar-visibility.spec.ts`.
 */
test.describe('account-menu · ACCOUNT_MENU_ITEMS', () => {
  test('has exactly the eight Cuenta entries, in order', () => {
    expect(ACCOUNT_MENU_ITEMS.map(i => i.label)).toEqual([
      'Mi cuenta',
      'Favoritos',
      'Pedidos',
      'Suscripciones',
      'Referidos',
      'Notificaciones',
      'Tema',
      'Cambiar a modo vendedor',
    ])
  })

  test('every link item points at its existing route', () => {
    const hrefs = Object.fromEntries(
      ACCOUNT_MENU_ITEMS.filter(i => i.kind === 'link').map(i => [i.key, i.href]),
    )
    expect(hrefs).toEqual({
      'account-home': '/account',
      favorites: '/account/favorites',
      orders: '/account/orders',
      subscriptions: '/account/subscriptions',
      referrals: '/account/referrals',
      notifications: '/account/notificaciones',
      'seller-mode': '/shop/manage',
    })
  })

  test('"Mi cuenta" is the first entry and leads to the bare /account hub', () => {
    expect(ACCOUNT_MENU_ITEMS[0]).toMatchObject({ kind: 'link', key: 'account-home', label: 'Mi cuenta', href: '/account' })
  })

  test('no "Agente IA" row (dropped — already reachable via the footer + search-bar agent affordances)', () => {
    expect(ACCOUNT_MENU_ITEMS.find(i => i.key === 'agent')).toBeUndefined()
    expect(ACCOUNT_MENU_ITEMS.map(i => i.label)).not.toContain('Agente IA')
  })

  test('"Cambiar a modo vendedor" is the doorway to /shop/manage', () => {
    const seller = ACCOUNT_MENU_ITEMS.find(i => i.key === 'seller-mode')
    expect(seller).toBeDefined()
    expect(seller).toMatchObject({ kind: 'link', label: 'Cambiar a modo vendedor', href: '/shop/manage' })
  })

  test('"Tema" is a theme action, not a route', () => {
    const theme = ACCOUNT_MENU_ITEMS.find(i => i.key === 'theme')
    expect(theme).toMatchObject({ kind: 'theme', label: 'Tema' })
    expect(theme).not.toHaveProperty('href')
  })

  test('every item carries a non-empty label + icon and a unique key', () => {
    const keys = ACCOUNT_MENU_ITEMS.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const item of ACCOUNT_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.icon).toMatch(/^iconoir-/)
    }
  })
})
