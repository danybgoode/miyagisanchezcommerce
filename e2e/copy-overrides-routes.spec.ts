import { expect, test } from '@playwright/test'
import { routeForKey, routeForNamespaceSection, namespaceLabel, NO_SINGLE_PAGE_LABEL } from '../lib/copy-overrides-routes'

// Pure-seam coverage for the namespace/section → page/URL lookup (epic 08 ·
// cms-contenido-restore-and-polish, Story 2.1). No browser, no network.

test.describe('routeForKey / routeForNamespaceSection', () => {
  test('simple single-page namespaces resolve to their real route', () => {
    expect(routeForKey('home', 'ribbon.body')).toEqual({ label: 'Inicio', path: '/' })
    expect(routeForKey('terms', 'title')).toEqual({ label: 'Términos', path: '/terminos' })
    expect(routeForKey('acerca', 'intro')).toEqual({ label: 'Acerca (plataforma)', path: '/acerca' })
    expect(routeForKey('sweepstakes', 'title')).toEqual({ label: 'Sorteos', path: '/g/[slug]' })
    expect(routeForKey('events', 'title')).toEqual({ label: 'Eventos', path: '/e/[slug]' })
  })

  test('sellerAcquisition fans out per-section to the real /vende/* page', () => {
    expect(routeForKey('sellerAcquisition', 'anchor.heroTitle')).toEqual({ label: 'Vende (portada)', path: '/vende' })
    expect(routeForKey('sellerAcquisition', 'autos.heroTitle')).toEqual({ label: 'Vende — Autos', path: '/vende/autos' })
    expect(routeForKey('sellerAcquisition', 'migracionShopify.heroTitle')).toEqual({
      label: 'Vende — Migración Shopify',
      path: '/vende/migracion/shopify',
    })
  })

  test('sellerAcquisition.shared (cross-page copy) and site-wide config namespaces resolve to null', () => {
    expect(routeForNamespaceSection('sellerAcquisition', 'shared')).toBeNull()
    expect(routeForNamespaceSection('platformTheme', 'anything')).toBeNull()
    expect(routeForNamespaceSection('pwaSearch', 'anything')).toBeNull()
  })

  test('an unrecognized namespace resolves to null, same as the no-single-page case', () => {
    expect(routeForNamespaceSection('doesNotExist', 'x')).toBeNull()
  })

  test('NO_SINGLE_PAGE_LABEL is a non-empty es-MX fallback string', () => {
    expect(NO_SINGLE_PAGE_LABEL.length).toBeGreaterThan(0)
  })
})

test.describe('namespaceLabel', () => {
  test('sellerAcquisition gets a distinct "todas las páginas" label (it fans out per-section)', () => {
    expect(namespaceLabel('sellerAcquisition')).toBe('Vende (todas las páginas)')
  })

  test('a simple single-page namespace reuses its route label', () => {
    expect(namespaceLabel('home')).toBe('Inicio')
    expect(namespaceLabel('terms')).toBe('Términos')
  })

  test('an unrecognized namespace falls back to the raw key', () => {
    expect(namespaceLabel('doesNotExist')).toBe('doesNotExist')
  })
})
