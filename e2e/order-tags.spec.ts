import { test, expect } from '@playwright/test'
import { normalizeTag, addTag, removeTag, dedupeTags } from '../lib/order-tags'

/**
 * ml-orders-native S3 · US-7 — pure tag normalize/add/remove/dedupe logic. No
 * network, no DB — mirrors `ml-order-badge.spec.ts`'s pure-logic pattern. The
 * backend's `[id]/tags` route re-normalizes independently at persist time; this
 * covers the client-side preview layer used by `OrderDetail.tsx`'s tag editor.
 */

test.describe('order-tags · normalizeTag', () => {
  test('trims and collapses whitespace', () => {
    expect(normalizeTag('  urgente  ')).toBe('urgente')
    expect(normalizeTag('muy   urgente')).toBe('muy urgente')
  })

  test('rejects empty or whitespace-only input', () => {
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
  })

  test('caps length at 30 chars', () => {
    const long = 'a'.repeat(50)
    expect(normalizeTag(long)?.length).toBe(30)
  })
})

test.describe('order-tags · addTag', () => {
  test('appends a new valid tag', () => {
    expect(addTag([], 'urgente')).toEqual(['urgente'])
    expect(addTag(['urgente'], 'frágil')).toEqual(['urgente', 'frágil'])
  })

  test('is a no-op for an empty/whitespace tag', () => {
    expect(addTag(['urgente'], '   ')).toEqual(['urgente'])
  })

  test('dedupes case-insensitively, keeping the existing entry', () => {
    expect(addTag(['Urgente'], 'urgente')).toEqual(['Urgente'])
  })

  test('the automatic "mercadolibre" tag round-trips like any other tag', () => {
    expect(addTag([], 'mercadolibre')).toEqual(['mercadolibre'])
    expect(addTag(['mercadolibre'], 'mercadolibre')).toEqual(['mercadolibre'])
  })
})

test.describe('order-tags · removeTag', () => {
  test('removes a matching tag case-insensitively', () => {
    expect(removeTag(['Urgente', 'frágil'], 'urgente')).toEqual(['frágil'])
  })

  test('is a no-op when the tag is absent', () => {
    expect(removeTag(['urgente'], 'nope')).toEqual(['urgente'])
  })

  test('the automatic "mercadolibre" tag can be removed like any other', () => {
    expect(removeTag(['mercadolibre', 'urgente'], 'mercadolibre')).toEqual(['urgente'])
  })
})

test.describe('order-tags · dedupeTags', () => {
  test('collapses case-insensitive duplicates, keeping first-seen casing and order', () => {
    expect(dedupeTags(['Urgente', 'frágil', 'urgente'])).toEqual(['Urgente', 'frágil'])
  })

  test('empty array stays empty', () => {
    expect(dedupeTags([])).toEqual([])
  })
})
