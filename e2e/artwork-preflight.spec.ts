import { test, expect } from '@playwright/test'
import { checkArtworkResolution, parseSizeCm } from '../lib/personalization'

/**
 * Custom print products · Sprint 3, Story 3.3.
 * Pure-logic guards on the low-res preflight — warns, never blocks. No
 * network; deterministic.
 */
test.describe('personalization · checkArtworkResolution', () => {
  test('warns when the image is below ~300 PPI for the chosen physical size', () => {
    // 400x400px at 10cm ≈ 118 PPI — well under 300.
    const result = checkArtworkResolution({ pixelWidth: 400, pixelHeight: 400, physicalCm: 10 })
    expect(result.warn).toBe(true)
    expect(result.message).toContain('10cm')
  })

  test('does not warn when resolution comfortably clears ~300 PPI', () => {
    // 1200x1200px at 10cm ≈ 305 PPI on the shortest side.
    const result = checkArtworkResolution({ pixelWidth: 1200, pixelHeight: 1200, physicalCm: 10 })
    expect(result.warn).toBe(false)
    expect(result.message).toBeUndefined()
  })

  test('uses the shortest side for a non-square image', () => {
    const result = checkArtworkResolution({ pixelWidth: 3000, pixelHeight: 400, physicalCm: 10 })
    expect(result.warn).toBe(true)
  })

  test('never warns when pixel dimensions or physical size are unknown (silently skips)', () => {
    expect(checkArtworkResolution({}).warn).toBe(false)
    expect(checkArtworkResolution({ pixelWidth: 400, pixelHeight: 400 }).warn).toBe(false)
    expect(checkArtworkResolution({ pixelWidth: 400, pixelHeight: 400, physicalCm: 0 }).warn).toBe(false)
    expect(checkArtworkResolution({ pixelWidth: 0, pixelHeight: 0, physicalCm: 10 }).warn).toBe(false)
  })
})

test.describe('personalization · parseSizeCm', () => {
  test('extracts the number immediately before "cm" in common seller-authored formats', () => {
    expect(parseSizeCm('10cm')).toBe(10)
    expect(parseSizeCm('10 cm')).toBe(10)
    expect(parseSizeCm('7.5cm')).toBe(7.5)
    // Multi-dimension values take the number closest to the unit (15, not
    // the width 10) — a best-effort single-number heuristic, not a real
    // width×height parse.
    expect(parseSizeCm('10 × 15 cm')).toBe(15)
  })

  test('returns null for unparseable/absent input — caller silently skips the preflight', () => {
    expect(parseSizeCm('Rojo')).toBeNull()
    expect(parseSizeCm('')).toBeNull()
    expect(parseSizeCm(null)).toBeNull()
    expect(parseSizeCm(undefined)).toBeNull()
  })
})
