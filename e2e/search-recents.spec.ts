import { expect, test } from '@playwright/test'
import {
  RECENTS_CAP,
  normalizeTerm,
  dedupeCap,
  searchHref,
} from '../lib/search-recents'

// Pure-logic gate for the PWA bottom-sheet search recents (S2.1). No DOM / no
// network — exercises the helper the SearchSheet relies on directly.

test.describe('search-recents · pure helpers', () => {
  test('normalizeTerm trims and collapses whitespace', () => {
    expect(normalizeTerm('  bonsái  ')).toBe('bonsái')
    expect(normalizeTerm('sala\t  de   estar')).toBe('sala de estar')
    expect(normalizeTerm('   ')).toBe('')
    expect(normalizeTerm('')).toBe('')
  })

  test('dedupeCap puts the newest term first', () => {
    expect(dedupeCap(['mesa', 'silla'], 'lámpara')).toEqual(['lámpara', 'mesa', 'silla'])
  })

  test('dedupeCap de-dupes case-insensitively, lifting the term to the front', () => {
    expect(dedupeCap(['Mesa', 'silla'], 'mesa')).toEqual(['mesa', 'silla'])
    expect(dedupeCap(['iPhone', 'sala'], 'IPHONE')).toEqual(['IPHONE', 'sala'])
  })

  test('dedupeCap caps the list to N, dropping the oldest', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'] // already at cap (6)
    expect(dedupeCap(list, 'g')).toHaveLength(RECENTS_CAP)
    expect(dedupeCap(list, 'g')).toEqual(['g', 'a', 'b', 'c', 'd', 'e'])
  })

  test('dedupeCap honors a custom cap', () => {
    expect(dedupeCap(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })

  test('dedupeCap ignores a blank term but still cleans + caps the list', () => {
    expect(dedupeCap(['mesa', '  ', 'silla'], '   ')).toEqual(['mesa', 'silla'])
    expect(dedupeCap(['a', 'b', 'c', 'd', 'e', 'f', 'g'], '')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  test('searchHref encodes the query into /l?q=', () => {
    expect(searchHref('bonsái')).toBe('/l?q=bons%C3%A1i')
    expect(searchHref('sala de estar')).toBe('/l?q=sala%20de%20estar')
    expect(searchHref('  guitarra -rota ')).toBe('/l?q=guitarra%20-rota')
  })

  test('searchHref degrades a blank query to /l', () => {
    expect(searchHref('')).toBe('/l')
    expect(searchHref('   ')).toBe('/l')
  })
})
