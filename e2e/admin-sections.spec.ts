import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ADMIN_SECTIONS, activeAdminSectionHref } from '../lib/admin/sections'

/**
 * Admin section registry — pure logic (api gate, no browser). `AdminShell` and
 * the `/admin` hub render from `ADMIN_SECTIONS`, so the nav can't drift from
 * the routes or this test. Also guards two structural invariants of S1:
 *  - the hub is no longer a redirect to the external scraper;
 *  - the orphaned `AdminScrapeClient.tsx` stays deleted (anti-resurrection).
 */

const ADMIN_DIR = fileURLToPath(new URL('../app/(shell)/admin', import.meta.url))

test.describe('admin · ADMIN_SECTIONS registry', () => {
  test('lists the S1 sections (Cupones, Edición impresa, Scraping)', () => {
    expect(ADMIN_SECTIONS.map(s => s.label)).toEqual(['Cupones', 'Edición impresa', 'Scraping'])
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
  // The anti-resurrection check for AdminScrapeClient.tsx is added in S1.3,
  // when the orphaned file is deleted.
})
