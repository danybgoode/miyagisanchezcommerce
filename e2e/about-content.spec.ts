import { expect, test } from '@playwright/test'
import {
  ABOUT_CTA_HREF,
  ABOUT_PAGE,
  ABOUT_SECTION_IDS,
  ABOUT_SECTIONS,
  aboutCopy,
  getAboutSection,
  type AboutLocale,
} from '../lib/about-content'

const LOCALES: AboutLocale[] = ['es', 'en']
const STUB_IDS = ['founder', 'pricing'] as const
const GROUNDED_IDS = ['what_is', 'why_sell', 'how_to_start', 'cost_transparency', 'philosophy'] as const

test.describe('about-content · single bilingual source', () => {
  test('section ids cover exactly the seven sections, in order, no dupes', () => {
    expect(ABOUT_SECTION_IDS).toEqual([
      'what_is',
      'why_sell',
      'how_to_start',
      'cost_transparency',
      'pricing',
      'founder',
      'philosophy',
    ])
    expect(ABOUT_SECTIONS.map((s) => s.id)).toEqual(ABOUT_SECTION_IDS)
  })

  test('every section has non-empty es AND en copy (heading + body)', () => {
    for (const section of ABOUT_SECTIONS) {
      for (const locale of LOCALES) {
        const copy = aboutCopy(section, locale)
        expect(copy.heading.trim(), `${section.id}.${locale}.heading`).not.toBe('')
        expect(copy.body.length, `${section.id}.${locale}.body`).toBeGreaterThan(0)
        for (const paragraph of copy.body) {
          expect(paragraph.trim(), `${section.id}.${locale}.body paragraph`).not.toBe('')
        }
        for (const point of copy.points ?? []) {
          expect(point.title.trim(), `${section.id}.${locale}.point.title`).not.toBe('')
          expect(point.body.trim(), `${section.id}.${locale}.point.body`).not.toBe('')
        }
      }
    }
  })

  test('founder + pricing are flagged stubs; the five grounded sections are not', () => {
    for (const id of STUB_IDS) {
      expect(getAboutSection(id).stub, `${id} should be a stub`).toBe(true)
    }
    for (const id of GROUNDED_IDS) {
      expect(getAboutSection(id).stub, `${id} should be grounded`).toBe(false)
    }
  })

  test('page-level copy present in both locales + CTA points at onboarding', () => {
    for (const locale of LOCALES) {
      const page = ABOUT_PAGE[locale]
      for (const [key, value] of Object.entries(page)) {
        expect(value.trim(), `ABOUT_PAGE.${locale}.${key}`).not.toBe('')
      }
    }
    expect(ABOUT_CTA_HREF).toBe('/sell?from=acerca')
  })

  test('getAboutSection throws on an unknown id', () => {
    // @ts-expect-error — intentionally invalid id
    expect(() => getAboutSection('nope')).toThrow()
  })
})
