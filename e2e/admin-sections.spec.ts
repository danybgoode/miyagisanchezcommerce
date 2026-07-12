import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ADMIN_SECTIONS, ADMIN_SECTION_GROUP_LABELS, activeAdminSectionHref } from '../lib/admin/sections'

/**
 * Admin section registry — pure logic (api gate, no browser). `AdminShell` and
 * the `/admin` hub render from `ADMIN_SECTIONS`, so the nav can't drift from
 * the routes or this test. Also guards two structural invariants of S1:
 *  - the hub is no longer a redirect to the external scraper;
 *  - the orphaned `AdminScrapeClient.tsx` stays deleted (anti-resurrection).
 */

const ADMIN_DIR = fileURLToPath(new URL('../app/(shell)/admin', import.meta.url))

test.describe('admin · ADMIN_SECTIONS registry', () => {
  test('lists the sections in order (S1 + S2 re-homed/extracted/new/audit + S3 tenants + Selección + promoter + flags + contenido)', () => {
    expect(ADMIN_SECTIONS.map(s => s.key)).toEqual([
      'coupons', 'print', 'supply', 'vecindario', 'seleccion', 'contenido', 'referrals', 'promoter', 'audit', 'tenants', 'flags', 'scraping',
    ])
  })

  test('admin-content-and-announcements S1.2 registers the runtime copy-override editor', () => {
    const byKey = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.key, s]))
    expect(byKey.contenido?.href).toBe('/admin/contenido')
    expect(byKey.contenido?.external).toBeUndefined()
    expect(byKey.contenido?.risk).toBe('low')
  })

  test('feature-flags control surface registers as an internal, high-risk section', () => {
    const byKey = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.key, s]))
    expect(byKey.flags?.href).toBe('/admin/flags')
    expect(byKey.flags?.external).toBeUndefined()
    expect(byKey.flags?.risk).toBe('high')
  })

  test('S3 registers the read-only tenant directory', () => {
    const byKey = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.key, s]))
    expect(byKey.tenants?.href).toBe('/admin/tenants')
    expect(byKey.tenants?.external).toBeUndefined()
  })

  test('Homepage Selección registers the curation screen (internal, med-risk)', () => {
    const byKey = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.key, s]))
    expect(byKey.seleccion?.href).toBe('/admin/seleccion')
    expect(byKey.seleccion?.external).toBeUndefined()
    expect(byKey.seleccion?.risk).toBe('med')
  })

  test('S2.2 registers the re-homed supply, extracted vecindario, and referrals sections', () => {
    const byKey = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.key, s]))
    expect(byKey.supply?.href).toBe('/admin/supply')
    expect(byKey.vecindario?.href).toBe('/admin/vecindario')
    expect(byKey.referrals?.href).toBe('/admin/referrals')
  })

  test('internal entries target an /admin/* route; external entries are absolute URLs', () => {
    for (const section of ADMIN_SECTIONS) {
      if (section.external) {
        expect(section.href, section.label).toMatch(/^https?:\/\//)
      } else {
        expect(section.href.startsWith('/admin'), section.label).toBe(true)
      }
    }
  })

  test('the scraper is an external link-out (not absorbed)', () => {
    const scraping = ADMIN_SECTIONS.find(s => s.key === 'scraping')
    expect(scraping?.external).toBe(true)
    expect(scraping?.href).toContain('miyagisanchez-scraper.vercel.app')
  })

  test('every section has a valid nav group (Sprint 3 · Story 3.3 grouping)', () => {
    const validGroups = Object.keys(ADMIN_SECTION_GROUP_LABELS)
    for (const section of ADMIN_SECTIONS) {
      expect(validGroups, section.key).toContain(section.group)
    }
  })

  test('Contenido groups under Sitio, Flags/Audit/Tenants/Scraping under Administración (Story 3.3)', () => {
    const byKey = Object.fromEntries(ADMIN_SECTIONS.map(s => [s.key, s]))
    expect(byKey.contenido?.group).toBe('sitio')
    expect(byKey.flags?.group).toBe('administracion')
    expect(byKey.audit?.group).toBe('administracion')
    expect(byKey.tenants?.group).toBe('administracion')
    expect(byKey.scraping?.group).toBe('administracion')
  })

  test('every section has a stable unique key, an Iconoir icon, and es-MX copy', () => {
    const keys = ADMIN_SECTIONS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const section of ADMIN_SECTIONS) {
      expect(section.icon.startsWith('iconoir-'), section.label).toBe(true)
      expect(section.label.length, section.key).toBeGreaterThan(0)
      expect(section.description.length, section.key).toBeGreaterThan(0)
    }
  })
})

test.describe('admin · activeAdminSectionHref', () => {
  test('a section page highlights its own entry (longest prefix)', () => {
    expect(activeAdminSectionHref('/admin/coupons')).toBe('/admin/coupons')
    expect(activeAdminSectionHref('/admin/print')).toBe('/admin/print')
    expect(activeAdminSectionHref('/admin/print/ed_1')).toBe('/admin/print')
  })

  test('the hub root and unknown paths highlight nothing', () => {
    expect(activeAdminSectionHref('/admin')).toBeNull()
    expect(activeAdminSectionHref('/account')).toBeNull()
    expect(activeAdminSectionHref('')).toBeNull()
  })

  test('an external section never matches', () => {
    expect(activeAdminSectionHref('https://miyagisanchez-scraper.vercel.app/admin')).toBeNull()
  })
})

test.describe('admin · S1 structural invariants', () => {
  test('the hub no longer redirects to the external scraper', () => {
    const page = readFileSync(`${ADMIN_DIR}/page.tsx`, 'utf8')
    expect(page).not.toContain('redirect(`https://miyagisanchez-scraper')
    expect(page).not.toContain("redirect('https://miyagisanchez-scraper")
  })
  test('the orphaned AdminScrapeClient is gone (anti-resurrection)', () => {
    const files = readdirSync(ADMIN_DIR)
    expect(files).not.toContain('AdminScrapeClient.tsx')
  })
})

test.describe('admin · S2.2 structural invariants', () => {
  test('Vecindario moderation moved out of Print into its own section', () => {
    const print = readFileSync(`${ADMIN_DIR}/print/PrintAdminClient.tsx`, 'utf8')
    // The "Mostrar en línea" web_visible toggle now lives only in Vecindario.
    expect(print).not.toContain('Mostrar en línea')
    expect(print).not.toContain('/social')
    const vecindario = readFileSync(`${ADMIN_DIR}/vecindario/VecindarioAdminClient.tsx`, 'utf8')
    expect(vecindario).toContain('Mostrar en línea')
  })

  test('supply is re-homed under the admin shell (no top-level page component)', () => {
    const files = readdirSync(`${ADMIN_DIR}/supply`)
    expect(files).toContain('SupplyClient.tsx')
    expect(files).toContain('page.tsx')
  })
})
